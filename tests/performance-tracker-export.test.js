const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

// The tracker reaches every N/ module lazily through the ambient require, which routes through
// Module._load. These fakes stand in for a SuiteScript runtime: a scope record lookup (or none),
// a cache that remembers nothing between tests, and a record module that counts what it saved.
let scopeRow = null;
const cacheStore = new Map();
const savedRecords = [];
const nsLogCalls = [];

const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request) {
    switch (request) {
        case 'N/runtime':
            return {
                executionContext: 'RESTLET',
                envType: 'SANDBOX',
                accountId: '123',
                getCurrentScript() {
                    return { id: 'customscript_demo_user', deploymentId: 'customdeploy_demo_user', getRemainingUsage: () => 1000 };
                },
                getCurrentUser() {
                    return { id: 7 };
                },
            };
        case 'N/cache':
            return {
                Scope: { PUBLIC: 'PUBLIC' },
                getCache() {
                    return {
                        get: ({ key }) => cacheStore.get(key) || null,
                        put: ({ key, value }) => cacheStore.set(key, value),
                    };
                },
            };
        case 'N/search':
            return {
                create() {
                    return {
                        run() {
                            return {
                                getRange() {
                                    return scopeRow ? [{ getValue: (field) => scopeRow[field] }] : [];
                                },
                            };
                        },
                    };
                },
            };
        case 'N/record':
            return {
                create({ type }) {
                    const values = {};
                    return {
                        setValue: ({ fieldId, value }) => { values[fieldId] = value; },
                        save: () => { savedRecords.push({ type, values }); return savedRecords.length; },
                    };
                },
            };
        case 'N/format':
            throw new Error('N/format not available');
        case 'N/log':
            return {
                debug: (options) => nsLogCalls.push({ method: 'debug', ...options }),
                audit: (options) => nsLogCalls.push({ method: 'audit', ...options }),
                error: (options) => nsLogCalls.push({ method: 'error', ...options }),
                emergency: (options) => nsLogCalls.push({ method: 'emergency', ...options }),
            };
        default:
            return originalModuleLoad.apply(this, arguments);
    }
};

const telemetryExporter = require('../dist/telemetry-exporter');
const performanceTracker = require('../dist/performance-tracker');
const functionContext = require('../dist/function-context');
const telemetry = require('../dist/telemetry');
const log = require('../dist/log');

const entryMetadata = {
    scopeKey: 'app:demo',
    entryKind: 'restlet',
    entryKey: 'post',
    filePath: 'controllers/userController.ts',
    modulePath: 'controllers/userController',
    scriptType: 'Restlet',
};

function setScopeMode(mode) {
    scopeRow = mode ? { custrecord_ptrk_scope_mode: mode, custrecord_ptrk_scope_expires_at: '' } : null;
}

function installFakeExporter(acceptsLogEntries = true) {
    const batches = [];
    telemetryExporter.registerTelemetryExporter({ name: 'fake', acceptsLogEntries, export: (batch) => batches.push(batch) });
    return batches;
}

function runEndpoint(sink, work) {
    return telemetry.withWrapperTelemetrySink(sink, () => performanceTracker.runTrackedScriptEntry(entryMetadata, work));
}

test.beforeEach(() => {
    cacheStore.clear();
    savedRecords.length = 0;
    nsLogCalls.length = 0;
    telemetryExporter.clearTelemetryExporters();
    setScopeMode(null);
});

test('diagnostic: one batch per run carrying the child spans, the root span and the log lines', () => {
    setScopeMode('diagnostic');
    const batches = installFakeExporter();
    const sink = performanceTracker.createPerformanceTrackerSink();

    const result = runEndpoint(sink, () => {
        log.audit('endpoint started', { endpoint: 'roles' });
        return telemetry.runWrappedOperation({ module: 'record', action: 'load', detail: { type: 'employee', id: 7 } }, () => 'loaded');
    });

    assert.equal(result, 'loaded');
    assert.equal(batches.length, 1);
    const batch = batches[0];
    assert.equal(batch.mode, 'diagnostic');
    assert.equal(batch.scopeKey, 'app:demo');
    assert.deepEqual(batch.spans.map((span) => span.spanRole), ['module-call', 'entry']);
    assert.equal(batch.spans[1].status, 'SUCCESS');
    assert.equal(batch.spans[0].rootExecutionId, batch.spans[1].executionId);
    assert.equal(batch.logs.length, 1);
    assert.equal(batch.logs[0].title, 'endpoint started');
    assert.deepEqual(batch.logs[0].details, { endpoint: 'roles' });
    assert.equal(batch.logs[0].executionId, batch.executionId);
    assert.equal(batch.logs[0].scriptId, 'customscript_demo_user');
    assert.equal(savedRecords.length, 0, 'a registered exporter replaces the record writer');
});

test('boundary: only the root span is exported, the log lines still travel with it', () => {
    setScopeMode('boundary');
    const batches = installFakeExporter();
    const sink = performanceTracker.createPerformanceTrackerSink();

    runEndpoint(sink, () => {
        log.debug('inside');
        telemetry.runWrappedOperation({ module: 'search', action: 'run' }, () => []);
    });

    assert.equal(batches.length, 1);
    assert.equal(batches[0].mode, 'boundary');
    assert.deepEqual(batches[0].spans.map((span) => span.spanRole), ['entry']);
    assert.equal(batches[0].logs.length, 1);
});

test('off: nothing is tracked, nothing is exported, nothing is queued', () => {
    setScopeMode('off');
    const batches = installFakeExporter();
    const sink = performanceTracker.createPerformanceTrackerSink();

    runEndpoint(sink, () => {
        log.debug('inside');
        telemetry.runWrappedOperation({ module: 'search', action: 'run' }, () => []);
    });

    assert.equal(batches.length, 0);
    assert.deepEqual(telemetryExporter.takeTelemetryLogEntries('anything'), []);
    assert.equal(nsLogCalls.length, 1, 'N/log still receives the line');
});

test('no scope row falls back to boundary, not diagnostic', () => {
    setScopeMode(null);
    const batches = installFakeExporter();
    const sink = performanceTracker.createPerformanceTrackerSink();

    runEndpoint(sink, () => telemetry.runWrappedOperation({ module: 'search', action: 'run' }, () => []));

    assert.equal(batches.length, 1);
    assert.equal(batches[0].mode, 'boundary');
    assert.deepEqual(batches[0].spans.map((span) => span.spanRole), ['entry']);
});

test('with no exporter registered the record exporter is used, as before', () => {
    setScopeMode('diagnostic');
    const sink = performanceTracker.createPerformanceTrackerSink();

    runEndpoint(sink, () => telemetry.runWrappedOperation({ module: 'record', action: 'load' }, () => 'x'));

    assert.deepEqual(telemetryExporter.getTelemetryExporters().map((exporter) => exporter.name), ['netsuite-record']);
    assert.equal(savedRecords.length, 2);
    assert.equal(savedRecords[0].type, 'customrecord_ptrk_exec_span');
    assert.equal(savedRecords[0].values.custrecord_ptrk_span_role, 'module-call');
    assert.equal(savedRecords[1].values.custrecord_ptrk_span_role, 'entry');
});

test('log entries carry the function, call chain and the enclosing function arguments', () => {
    setScopeMode('boundary');
    const batches = installFakeExporter();
    const sink = performanceTracker.createPerformanceTrackerSink();

    const loadUser = (id, options) => functionContext.withFunctionContext(
        { functionName: 'loadUser', modulePath: 'services/userService', filePath: 'services/userService.ts', functionContext: 'variable-arrow-function', instrumentationSource: 'test', parameterNames: ['id', 'options'] },
        () => {
            log.audit('loading user');
            return id;
        },
        [id, options],
    );
    const roles = () => functionContext.withFunctionContext(
        { functionName: 'roles', modulePath: 'controllers/userController', filePath: 'controllers/userController.ts', functionContext: 'object-method', instrumentationSource: 'test' },
        () => loadUser(7, { includeInactive: false }),
    );

    runEndpoint(sink, () => roles());

    const [entry] = batches[0].logs;
    assert.equal(entry.functionName, 'loadUser');
    assert.equal(entry.functionModulePath, 'services/userService');
    assert.equal(entry.callChain, 'roles -> loadUser');
    assert.deepEqual(entry.functionArguments, { id: 7, options: { includeInactive: false } });
});

test('a log call outside any instrumented function or with no log-accepting exporter queues nothing extra', () => {
    setScopeMode('boundary');
    const batches = installFakeExporter(false);
    const sink = performanceTracker.createPerformanceTrackerSink();

    runEndpoint(sink, () => log.audit('plain'));

    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].logs, []);
});

test('an error thrown out of an instrumented function is recorded once on the root span with its arguments', () => {
    setScopeMode('boundary');
    const batches = installFakeExporter();
    const sink = performanceTracker.createPerformanceTrackerSink();

    const inner = (id) => functionContext.withFunctionContext(
        { functionName: 'inner', modulePath: 'mod', filePath: 'mod.ts', functionContext: '', instrumentationSource: 'test', parameterNames: ['id'] },
        () => { throw new RangeError(`no record ${id}`); },
        [id],
    );
    const outer = (id) => functionContext.withFunctionContext(
        { functionName: 'outer', modulePath: 'mod', filePath: 'mod.ts', functionContext: '', instrumentationSource: 'test', parameterNames: ['id'] },
        () => inner(id),
        [id],
    );

    assert.throws(() => runEndpoint(sink, () => outer(99)), /no record 99/);

    assert.equal(batches.length, 1);
    const rootSpan = batches[0].spans[batches[0].spans.length - 1];
    assert.equal(rootSpan.status, 'ERROR');
    const detail = JSON.parse(rootSpan.detail);
    assert.equal(detail.observedErrorCount, 1);
    assert.equal(detail.observedErrors[0].functionName, 'inner');
    assert.equal(detail.observedErrors[0].errorName, 'RangeError');
    assert.deepEqual(detail.observedErrors[0].functionArguments, { id: 99 });
});

test('wrapTrackedScriptEntryFunction makes a call result a tracked entry and leaves non-functions alone', () => {
    setScopeMode('boundary');
    const batches = installFakeExporter();
    const sink = performanceTracker.createPerformanceTrackerSink();

    const handler = function handler(body) { return { echoed: body, self: this && this.tag }; };
    const wrappedHandler = performanceTracker.wrapTrackedScriptEntryFunction(entryMetadata, handler);
    assert.equal(performanceTracker.wrapTrackedScriptEntryFunction(entryMetadata, 42), 42);

    const result = telemetry.withWrapperTelemetrySink(sink, () => wrappedHandler.call({ tag: 'ctx' }, { name: 'roles' }));

    assert.deepEqual(result, { echoed: { name: 'roles' }, self: 'ctx' });
    assert.equal(batches.length, 1);
    assert.equal(batches[0].spans[0].entryKey, 'post');
});
