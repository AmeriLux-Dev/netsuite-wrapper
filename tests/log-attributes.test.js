const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const nsLogCalls = [];
const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request) {
    if (request === 'N/log') {
        return {
            debug: (options) => nsLogCalls.push({ method: 'debug', ...options }),
            audit: (options) => nsLogCalls.push({ method: 'audit', ...options }),
            error: (options) => nsLogCalls.push({ method: 'error', ...options }),
            emergency: (options) => nsLogCalls.push({ method: 'emergency', ...options }),
        };
    }

    return originalModuleLoad.apply(this, arguments);
};

const log = require('../dist/log');
const executionTracking = require('../dist/execution-tracking');
const telemetryExporter = require('../dist/telemetry-exporter');

const ATTRIBUTE_TAIL_MARKER = '[[NSW_ATTR|1]]';

function withTrackedExecution(work) {
    const snapshot = executionTracking.startTrackedScriptExecution({
        scopeKey: 'scope',
        entryKind: 'kind',
        entryKey: 'key',
        filePath: 'file',
        modulePath: 'module',
        scriptType: 'type',
    });

    try {
        return work(snapshot);
    } finally {
        executionTracking.finishTrackedScriptExecution(snapshot.executionId);
    }
}

test.beforeEach(() => {
    nsLogCalls.length = 0;
    telemetryExporter.clearTelemetryExporters();
});

test.afterEach(() => {
    log.setChunkLogMode('group');
    log.setLogAttributeTailEnabled(true);
    telemetryExporter.clearTelemetryExporters();
});

test('log attribute tail is enabled by default', () => {
    assert.equal(log.isLogAttributeTailEnabled(), true);
});

test('appends the tail in the exact NSW_ATTR v1 format at the end of the detail', () => {
    log.audit({
        title: 'Order submission',
        details: 'no source location',
        attributes: { record_type: 'transferorder', record_id: 48812 },
    });

    assert.equal(nsLogCalls.length, 1);
    assert.equal(
        nsLogCalls[0].details,
        `no source location ${ATTRIBUTE_TAIL_MARKER}{"record_type":"transferorder","record_id":48812}`,
    );
});

test('the tail is appended after the tracker prefix and the message', () => {
    withTrackedExecution((active) => {
        log.audit({ title: 'title', details: 'body', attributes: { a: 1 } });

        assert.equal(nsLogCalls.length, 1);
        assert.equal(
            nsLogCalls[0].details,
            `[${active.executionId}] body ${ATTRIBUTE_TAIL_MARKER}{"a":1}`,
        );
    });
});

test('string-form calls are unchanged: no tail, no attributes possible', () => {
    log.audit('hello', { foo: 1 });

    assert.equal(nsLogCalls.length, 1);
    assert.equal(nsLogCalls[0].details, '{"foo":1}');
    assert.ok(!nsLogCalls[0].details.includes('NSW_ATTR'));
});

test('attributes are forwarded on the telemetry entry as data', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });

    withTrackedExecution((active) => {
        log.audit({ title: 'title', details: 'body', attributes: { record_id: 1 } });

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.equal(entries.length, 1);
        assert.deepEqual(entries[0].attributes, { record_id: 1 });
    });
});

test('a call with no attributes does not add an attributes field to the telemetry entry', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });

    withTrackedExecution((active) => {
        log.audit({ title: 'title', details: 'body' });

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.equal(entries.length, 1);
        assert.equal('attributes' in entries[0], false);
    });
});

test('JSON longer than 1024 characters is dropped from the detail with its size reported', () => {
    const bigValue = 'x'.repeat(1100);

    log.audit({ title: 'title', details: 'body', attributes: { big: bigValue } });

    assert.equal(nsLogCalls.length, 1);
    const fullJson = JSON.stringify({ big: bigValue });
    assert.ok(fullJson.length > 1024);
    assert.equal(
        nsLogCalls[0].details,
        `body ${ATTRIBUTE_TAIL_MARKER}{"_dropped":true,"_size":${fullJson.length}}`,
    );
});

// The way a downstream parser is told to read the tail: from the last marker in the line.
function parseAttributeTailJson(details) {
    const markerIndex = details.lastIndexOf(ATTRIBUTE_TAIL_MARKER);
    assert.ok(markerIndex !== -1, `expected the tail marker in: ${details}`);
    return JSON.parse(details.slice(markerIndex + ATTRIBUTE_TAIL_MARKER.length));
}

test('a circular value nested under one key is stringified there; other keys stay intact', () => {
    const nested = {};
    nested.self = nested;

    log.audit({ title: 'title', details: 'body', attributes: { ok: 1, bad: nested } });

    assert.equal(nsLogCalls.length, 1);
    const parsed = parseAttributeTailJson(nsLogCalls[0].details);
    assert.equal(parsed.ok, 1);
    assert.equal(typeof parsed.bad, 'string');
});

test('a throwing getter falls back to a string for that key; other keys stay intact', () => {
    const attributes = {
        ok: 1,
        get bad() {
            throw new Error('boom');
        },
    };

    log.audit({ title: 'title', details: 'body', attributes });

    assert.equal(nsLogCalls.length, 1);
    const parsed = parseAttributeTailJson(nsLogCalls[0].details);
    assert.equal(parsed.ok, 1);
    assert.equal(typeof parsed.bad, 'string');
});

test('a function value is present as its String(), not silently omitted', () => {
    function namedFunction() {}

    log.audit({ title: 'title', details: 'body', attributes: { ok: 1, fn: namedFunction } });

    assert.equal(nsLogCalls.length, 1);
    const parsed = parseAttributeTailJson(nsLogCalls[0].details);
    assert.equal(parsed.ok, 1);
    assert.equal(parsed.fn, String(namedFunction));
});

test('a BigInt value is stringified', () => {
    log.audit({ title: 'title', details: 'body', attributes: { big: 42n } });

    assert.equal(nsLogCalls.length, 1);
    const parsed = parseAttributeTailJson(nsLogCalls[0].details);
    assert.equal(parsed.big, '42');
});

test('a Proxy that throws on key enumeration drops the whole payload with size -1', () => {
    const attributes = new Proxy({}, {
        ownKeys() {
            throw new Error('no keys for you');
        },
    });

    log.audit({ title: 'title', details: 'body', attributes });

    assert.equal(nsLogCalls.length, 1);
    assert.equal(nsLogCalls[0].details, `body ${ATTRIBUTE_TAIL_MARKER}{"_dropped":true,"_size":-1}`);
});

test('circular attributes reach the telemetry entry as a serializable copy', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });
    const circular = { ok: 1 };
    circular.self = circular;

    withTrackedExecution((active) => {
        log.audit({ title: 'title', details: 'body', attributes: circular });

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.notEqual(entries[0].attributes, circular);
        assert.deepEqual(entries[0].attributes, { ok: 1, self: '[object Object]' });
    });
});

test('the telemetry entry keeps the attributes as they were when the call was made', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });
    const attributes = { record_id: 1, nested: { status: 'open' } };

    withTrackedExecution((active) => {
        log.audit({ title: 'title', details: 'body', attributes });
        attributes.record_id = 2;
        attributes.nested.status = 'closed';
        attributes.added = true;

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.deepEqual(entries[0].attributes, { record_id: 1, nested: { status: 'open' } });
    });
});

test('an Error value keeps its name and message in both the tail and the telemetry entry', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });

    withTrackedExecution((active) => {
        log.error({ title: 'title', details: 'body', attributes: { cause: new TypeError('credit hold'), record_id: 5 } });

        const expected = { cause: { errorName: 'TypeError', message: 'credit hold' }, record_id: 5 };
        assert.deepEqual(parseAttributeTailJson(nsLogCalls[0].details), expected);
        assert.deepEqual(telemetryExporter.takeTelemetryLogEntries(active.executionId)[0].attributes, expected);
    });
});

test('attributes whose keys cannot be read reach the telemetry entry as an unreadable placeholder', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });
    const attributes = new Proxy({}, {
        ownKeys() {
            throw new Error('no keys for you');
        },
    });

    withTrackedExecution((active) => {
        log.audit({ title: 'title', details: 'body', attributes });

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.deepEqual(entries[0].attributes, { _dropped: true, _reason: 'unreadable', _size: -1 });
    });
});

test('the telemetry copy holds attributes up to 4000 characters and a placeholder beyond that', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });
    const midsize = { note: 'm'.repeat(2000) };
    const oversize = { note: 'o'.repeat(5000) };

    withTrackedExecution((active) => {
        log.audit({ title: 'midsize', details: 'body', attributes: midsize });
        log.audit({ title: 'oversize', details: 'body', attributes: oversize });

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.deepEqual(entries[0].attributes, midsize, 'over the 1024 tail limit but within the copy limit');
        assert.deepEqual(entries[1].attributes, { _dropped: true, _reason: 'too_large', _size: JSON.stringify(oversize).length });
        assert.deepEqual(parseAttributeTailJson(nsLogCalls[0].details), { _dropped: true, _size: JSON.stringify(midsize).length });
    });
});

test('the attributes are read once per call, for the tail and the telemetry copy together', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });
    let readCount = 0;
    const attributes = {
        get record_id() {
            readCount += 1;
            return 42;
        },
    };

    withTrackedExecution(() => {
        log.audit({ title: 'title', details: 'body', attributes });
    });

    assert.equal(readCount, 1);
});

test('a marker inside an attribute value is escaped, so the last marker in the line is the real tail', () => {
    const attributes = { copied: `earlier line ${ATTRIBUTE_TAIL_MARKER}{"x":1}`, record_id: 3 };

    log.audit({ title: 'title', details: `body quoting ${ATTRIBUTE_TAIL_MARKER}{"y":2}`, attributes });

    const detail = nsLogCalls[0].details;
    assert.equal(detail.split(ATTRIBUTE_TAIL_MARKER).length - 1, 2, 'one marker in the message, one real tail, none inside the JSON');
    assert.deepEqual(parseAttributeTailJson(detail), attributes);
});

test('off mode also cuts the message for the dropped placeholder and marks it truncated', () => {
    log.setChunkLogMode('off');
    try {
        log.audit({ title: 'title', details: 'z'.repeat(9000), attributes: { big: 'x'.repeat(1100) } });

        assert.equal(nsLogCalls.length, 1);
        const detail = nsLogCalls[0].details;
        assert.ok(detail.length <= 3980, `expected detail within budget, got ${detail.length}`);
        assert.deepEqual(parseAttributeTailJson(detail), {
            _dropped: true,
            _size: JSON.stringify({ big: 'x'.repeat(1100) }).length,
            _truncated: true,
        });
    } finally {
        log.setChunkLogMode('group');
    }
});

test('off mode cuts the message to fit the tail and marks the JSON truncated', () => {
    log.setChunkLogMode('off');
    try {
        const body = 'z'.repeat(9000);
        log.audit({ title: 'title', details: body, attributes: { a: 1 } });

        assert.equal(nsLogCalls.length, 1);
        const detail = nsLogCalls[0].details;
        assert.ok(detail.length <= 3980, `expected detail within budget, got ${detail.length}`);

        const markerIndex = detail.indexOf(ATTRIBUTE_TAIL_MARKER);
        assert.ok(markerIndex !== -1, 'expected the tail marker to be present');
        const json = detail.slice(markerIndex + ATTRIBUTE_TAIL_MARKER.length);
        assert.deepEqual(JSON.parse(json), { a: 1, _truncated: true });

        const messagePart = detail.slice(0, markerIndex - 1); // -1 for the separating space
        assert.ok(messagePart.length < body.length, 'message should have been cut');
        assert.ok(body.startsWith(messagePart));
    } finally {
        log.setChunkLogMode('group');
    }
});

test('off mode leaves a short message and its tail untouched (no truncation flag)', () => {
    log.setChunkLogMode('off');
    try {
        log.audit({ title: 'title', details: 'short body', attributes: { a: 1 } });

        assert.equal(nsLogCalls.length, 1);
        assert.equal(nsLogCalls[0].details, `short body ${ATTRIBUTE_TAIL_MARKER}{"a":1}`);
    } finally {
        log.setChunkLogMode('group');
    }
});

test('group mode: a chunked message carries the tail on the first chunk only', () => {
    log.setChunkLogMode('group');
    const body = 'g'.repeat(9000);

    log.audit({ title: 'title', details: body, attributes: { a: 1, b: 2 } });

    assert.ok(nsLogCalls.length >= 2, `expected multiple chunks, got ${nsLogCalls.length}`);

    for (const call of nsLogCalls) {
        assert.ok(call.details.length <= 3980, `chunk exceeded the budget: ${call.details.length}`);
    }

    const withTail = nsLogCalls.filter((call) => call.details.includes('NSW_ATTR'));
    assert.equal(withTail.length, 1, 'exactly one chunk should carry the attribute tail');
    assert.ok(nsLogCalls[0].details.includes('NSW_ATTR'), 'the tail must be on the first chunk');
    assert.ok(nsLogCalls[0].details.endsWith(`${ATTRIBUTE_TAIL_MARKER}{"a":1,"b":2}`));

    for (let index = 1; index < nsLogCalls.length; index += 1) {
        assert.ok(!nsLogCalls[index].details.includes('NSW_ATTR'), `chunk ${index} must not carry the tail`);
    }
});

test('silent mode: a chunked message carries the tail on the first chunk only', () => {
    log.setChunkLogMode('silent');
    try {
        const body = 's'.repeat(9000);

        log.audit({ title: 'title', details: body, attributes: { a: 1 } });

        assert.ok(nsLogCalls.length >= 2, `expected multiple chunks, got ${nsLogCalls.length}`);

        for (const call of nsLogCalls) {
            assert.ok(call.details.length <= 3980, `chunk exceeded the budget: ${call.details.length}`);
            assert.ok(!call.details.includes('NSW_CHUNK'), 'silent mode must not include the chunk marker');
        }

        assert.ok(nsLogCalls[0].details.endsWith(`${ATTRIBUTE_TAIL_MARKER}{"a":1}`), 'the tail must be on the first chunk');
        for (let index = 1; index < nsLogCalls.length; index += 1) {
            assert.ok(!nsLogCalls[index].details.includes('NSW_ATTR'), `chunk ${index} must not carry the tail`);
        }
    } finally {
        log.setChunkLogMode('group');
    }
});

test('setLogAttributeTailEnabled(false) removes the detail tail but the exporter still gets attributes', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });
    log.setLogAttributeTailEnabled(false);
    try {
        assert.equal(log.isLogAttributeTailEnabled(), false);

        withTrackedExecution((active) => {
            log.audit({ title: 'title', details: 'body', attributes: { a: 1 } });

            assert.equal(nsLogCalls.length, 1);
            assert.ok(!nsLogCalls[0].details.includes('NSW_ATTR'), 'the tail must not be written to the detail');
            assert.equal(nsLogCalls[0].details, `[${active.executionId}] body`);

            const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
            assert.deepEqual(entries[0].attributes, { a: 1 });
        });
    } finally {
        log.setLogAttributeTailEnabled(true);
    }
});

test('an empty attributes object is treated as no attributes', () => {
    log.audit({ title: 'title', details: 'body', attributes: {} });

    assert.equal(nsLogCalls.length, 1);
    assert.equal(nsLogCalls[0].details, 'body');
});
