const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

// N/* stubs for this file: each test sets the module it needs; N/log records what the wrapper reports.
const netsuiteModules = new Map();
const loggedErrors = [];
netsuiteModules.set('N/log', {
    debug() {},
    audit() {},
    error(options) {
        loggedErrors.push(options);
    },
    emergency() {},
});

const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request) {
    if (/^N\//.test(request)) {
        if (!netsuiteModules.has(request)) {
            throw new Error(`Module does not exist: ${request}`);
        }
        return netsuiteModules.get(request);
    }

    return originalModuleLoad.apply(this, arguments);
};

const { observe, instrumentReturnedObject } = require('../dist/fail-open');
const { runWrappedOperation, withWrapperTelemetrySink } = require('../dist/telemetry');
const { runTrackedScriptEntry } = require('../dist/performance-tracker');
const { withFunctionContext } = require('../dist/function-context');

/** Work that counts its runs and returns (or throws) what it is given. */
function countedWork(outcome) {
    const work = () => {
        work.runs += 1;
        if (outcome instanceof Error) {
            throw outcome;
        }
        return outcome;
    };
    work.runs = 0;
    return work;
}

test('an observer that throws before running the work: the work runs once and its result comes back', () => {
    const work = countedWork('result');
    const result = observe(work, () => {
        throw new Error('bookkeeping failed');
    });

    assert.equal(result, 'result');
    assert.equal(work.runs, 1);
});

test('an observer that throws after the work succeeded: the result comes back, the work is not repeated', () => {
    const work = countedWork('saved');
    const result = observe(work, (observedWork) => {
        observedWork();
        throw new Error('span could not be built');
    });

    assert.equal(result, 'saved');
    assert.equal(work.runs, 1);
});

test('an observer that replaces the application error: the application error comes back', () => {
    const applicationError = new Error('INVALID_FLD_VALUE');
    const work = countedWork(applicationError);

    assert.throws(() => observe(work, (observedWork) => {
        try {
            observedWork();
        } catch (_error) {
            throw new Error('span could not be built');
        }
    }), (error) => error === applicationError);
    assert.equal(work.runs, 1);
});

test('an observer that swallows the application error: the application error still comes back', () => {
    const applicationError = new Error('RCRD_DSNT_EXIST');
    const work = countedWork(applicationError);

    assert.throws(() => observe(work, (observedWork) => {
        try {
            return observedWork();
        } catch (_error) {
            return 'swallowed';
        }
    }), (error) => error === applicationError);
    assert.equal(work.runs, 1);
});

test('an observer that returns without running the work: the work runs once', () => {
    const work = countedWork('ran');
    assert.equal(observe(work, () => 'skipped'), 'ran');
    assert.equal(work.runs, 1);
});

test('an observer that runs the work twice: the work runs once', () => {
    const work = countedWork('once');
    const result = observe(work, (observedWork) => {
        observedWork();
        return observedWork();
    });

    assert.equal(result, 'once');
    assert.equal(work.runs, 1);
});

test('an observer that changes the result: the application gets what the work returned', () => {
    const work = countedWork({ id: 7 });
    const result = observe(work, (observedWork) => ({ ...observedWork(), id: 8 }));
    assert.deepEqual(result, { id: 7 });
});

test('a promise: the application gets the same promise, and a failing bookkeeping chain is not an unhandled rejection', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        const promise = Promise.resolve('value');
        const result = observe(() => promise, (observedWork) => observedWork().then(() => {
            throw new Error('span could not be built');
        }));

        assert.equal(result, promise);
        assert.equal(await result, 'value');
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('a wrapper failure is reported to N/log once per loaded script', () => {
    loggedErrors.length = 0;
    // The earlier tests in this file already reported; a fresh module instance reports again, once.
    delete require.cache[require.resolve('../dist/fail-open')];
    const freshFailOpen = require('../dist/fail-open');
    freshFailOpen.observe(() => 1, () => {
        throw new Error('first');
    });
    freshFailOpen.observe(() => 2, () => {
        throw new Error('second');
    });

    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0].title, 'netsuite-wrapper stepped aside');
    assert.match(loggedErrors[0].details, /first/);
});

test('runWrappedOperation: a sink that throws still lets the N/* call run once', () => {
    const work = countedWork('loaded');
    const brokenSink = {
        runOperation() {
            throw new Error('sink could not be created');
        },
    };

    assert.equal(withWrapperTelemetrySink(brokenSink, () => runWrappedOperation({ module: 'record', action: 'load' }, work)), 'loaded');
    assert.equal(work.runs, 1);
});

test('runWrappedOperation: metadata that cannot be built, or a sink whose isActive throws, still lets the call run', () => {
    const passingSink = { runOperation: (_metadata, work) => work() };
    const metadataWork = countedWork('from metadata case');
    assert.equal(withWrapperTelemetrySink(passingSink, () => runWrappedOperation(() => {
        throw new TypeError('Cannot read properties of undefined');
    }, metadataWork)), 'from metadata case');
    assert.equal(metadataWork.runs, 1);

    const activeWork = countedWork('from isActive case');
    const sinkWithBrokenIsActive = {
        isActive() {
            throw new Error('no execution context');
        },
        runOperation: (_metadata, work) => work(),
    };
    assert.equal(withWrapperTelemetrySink(sinkWithBrokenIsActive, () => runWrappedOperation({ module: 'query', action: 'run' }, activeWork)), 'from isActive case');
    assert.equal(activeWork.runs, 1);
});

test('runTrackedScriptEntry: tracking that fails after the entry point ran does not change its result', () => {
    let entryFinished = false;
    const metadata = {
        scopeKey: 'app:test',
        entryKind: 'restlet',
        filePath: 'controllers/test.js',
        modulePath: 'controllers/test',
        scriptType: 'Restlet',
        get entryKey() {
            if (entryFinished) {
                throw new Error('root span could not be built');
            }
            return 'post';
        },
    };

    const response = runTrackedScriptEntry(metadata, () => {
        entryFinished = true;
        return { ok: true };
    });

    assert.deepEqual(response, { ok: true });
});

test('runTrackedScriptEntry: the entry point\'s own error reaches NetSuite unchanged', () => {
    const applicationError = new Error('USER_ERROR');
    const work = countedWork(applicationError);
    assert.throws(
        () => runTrackedScriptEntry({ scopeKey: 'app:test', entryKind: 'restlet', entryKey: 'post' }, work),
        (error) => error === applicationError,
    );
    assert.equal(work.runs, 1);
});

test('withFunctionContext: a context that cannot be read still runs the function once', () => {
    const work = countedWork(42);
    const unreadableContext = {
        get functionName() {
            throw new Error('context could not be read');
        },
    };

    assert.equal(withFunctionContext(unreadableContext, work), 42);
    assert.equal(work.runs, 1);
});

test('instrumentReturnedObject: an object that refuses the change comes back as NetSuite made it', () => {
    const nativeSave = () => 'native save';
    const record = Object.freeze({ type: 'salesorder', save: nativeSave });

    const result = instrumentReturnedObject(record, (target) => {
        'use strict';
        target.save = () => 'instrumented save';
        return target;
    });

    assert.equal(result, record);
    assert.equal(result.save(), 'native save');
});

test('record.load: a record whose save is read-only is returned untouched and still saves', () => {
    const loadedRecord = {};
    Object.defineProperty(loadedRecord, 'save', { value: () => 99, writable: false, enumerable: true });
    netsuiteModules.set('N/record', {
        Type: { SALES_ORDER: 'salesorder' },
        load: () => loadedRecord,
    });

    const record = require('../dist/record');
    const result = record.load({ type: 'salesorder', id: 1 });

    assert.equal(result, loadedRecord);
    assert.equal(result.save(), 99);
});

test('query.create: a frozen query object is returned untouched and still runs', () => {
    const frozenQuery = Object.freeze({ type: 'customer', run: () => ({ results: [] }) });
    netsuiteModules.set('N/query', {
        Operator: { ANY_OF: 'ANY_OF' },
        create: () => frozenQuery,
    });

    const query = require('../dist/query');
    const result = query.create({ type: 'customer' });

    assert.equal(result, frozenQuery);
    assert.deepEqual(result.run(), { results: [] });
    assert.equal(query.Operator.ANY_OF, 'ANY_OF');
});

test('log: a call the wrapper cannot format is logged as the application made it', () => {
    const debugCalls = [];
    netsuiteModules.set('N/log', {
        debug(...args) {
            debugCalls.push(args);
        },
        audit() {},
        error() {},
        emergency() {},
    });

    const log = require('../dist/log');
    const options = {
        get title() {
            throw new Error('title could not be read');
        },
        details: 'kept',
    };
    log.debug(options);

    assert.equal(debugCalls.length, 1);
    assert.equal(debugCalls[0][0], options);
});
