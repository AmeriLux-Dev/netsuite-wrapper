const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const nsLogCalls = [];
const httpsPosts = [];
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

    if (request === 'N/https') {
        return {
            post(options) {
                httpsPosts.push(options);
                return { code: 202, body: '' };
            },
        };
    }

    return originalModuleLoad.apply(this, arguments);
};

const log = require('../dist/log');
const executionTracking = require('../dist/execution-tracking');
const telemetryExporter = require('../dist/telemetry-exporter');
const { createHttpsExporter } = require('../dist/https-exporter');

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

function registerLogSink() {
    telemetryExporter.registerTelemetryExporter({ name: 'sink', acceptsLogEntries: true, export() {} });
}

test.beforeEach(() => {
    nsLogCalls.length = 0;
    httpsPosts.length = 0;
    telemetryExporter.clearTelemetryExporters();
});

test.afterEach(() => {
    log.setChunkLogMode('group');
    telemetryExporter.clearTelemetryExporters();
});

test('the telemetry entry keeps the details as they were when the call was made', () => {
    registerLogSink();
    const details = { status: 'open', lines: [1, 2] };

    withTrackedExecution((active) => {
        log.audit({ title: 'title', details });
        details.status = 'closed';
        details.lines.push(3);

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.deepEqual(entries[0].details, { status: 'open', lines: [1, 2] });
    });
});

test('strings, numbers and missing details reach the telemetry entry as they are', () => {
    registerLogSink();

    withTrackedExecution((active) => {
        log.audit({ title: 'string', details: 'plain text' });
        log.audit({ title: 'number', details: 5 });
        log.audit({ title: 'missing' });
        log.audit('string form', { endpoint: 'roles' });

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.deepEqual(entries.map((entry) => entry.details), ['plain text', 5, null, { endpoint: 'roles' }]);
    });
});

test('an Error passed as details keeps its name and message', () => {
    registerLogSink();

    withTrackedExecution((active) => {
        log.error({ title: 'title', details: new RangeError('quantity out of range') });

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.deepEqual(entries[0].details, { errorName: 'RangeError', message: 'quantity out of range' });
    });
});

test('circular details become a bounded copy with a circular marker', () => {
    registerLogSink();
    const details = { id: 1 };
    details.self = details;

    withTrackedExecution((active) => {
        log.audit({ title: 'title', details });

        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.deepEqual(entries[0].details, { id: 1, self: '[circular]' });
    });
});

test('circular details no longer cost the run its https export', () => {
    telemetryExporter.registerTelemetryExporter(createHttpsExporter({ url: 'https://collector.example.com/ingest' }));
    const details = { id: 1 };
    details.self = details;
    const bigAttributeValue = 10n;

    const logs = withTrackedExecution((active) => {
        log.audit({ title: 'healthy', details: 'fine' });
        log.audit({ title: 'circular', details, attributes: { amount: bigAttributeValue } });
        return telemetryExporter.takeTelemetryLogEntries(active.executionId);
    });
    nsLogCalls.length = 0;

    telemetryExporter.dispatchTelemetryBatch({ executionId: 'exec_1', flowId: 'flow_1', scopeKey: 'scope', mode: 'diagnostic', spans: [], logs });

    assert.equal(httpsPosts.length, 1, 'the batch must be sent');
    assert.equal(nsLogCalls.length, 0, 'nothing should be reported as failed');
    const sentLogs = JSON.parse(httpsPosts[0].body).logs;
    assert.deepEqual(sentLogs.map((entry) => entry.title), ['healthy', 'circular']);
    assert.deepEqual(sentLogs[1].attributes, { amount: '10' });
});

test('details over 8000 characters become a pointer, and only that call\'s rows carry its [log:N] tag', () => {
    registerLogSink();
    const bigDetails = 'x'.repeat(9000);

    withTrackedExecution((active) => {
        log.audit({ title: 'first', details: 'small' });
        log.audit({ title: 'second', details: { small: true } });
        log.audit({ title: 'big', details: bigDetails });

        const logReference = `[${active.executionId}] [log:3]`;
        const entries = telemetryExporter.takeTelemetryLogEntries(active.executionId);
        assert.deepEqual(entries[2].details, {
            _dropped: true,
            _reason: 'too_large',
            _size: 9000,
            _logReference: logReference,
        });

        const bigRows = nsLogCalls.filter((call) => call.title === 'big');
        assert.ok(bigRows.length >= 3, `expected the big details to be chunked, got ${bigRows.length} rows`);
        assert.deepEqual(
            nsLogCalls.filter((call) => call.details.includes(logReference)),
            bigRows,
            'searching N/log for the reference finds exactly the rows of that call',
        );
        assert.equal(bigRows.map((row) => row.details.replace(/^\[\[NSW_CHUNK\|[^\]]*\]\] /, '').slice(logReference.length + 1)).join(''), bigDetails);

        for (const call of nsLogCalls.filter((row) => row.title !== 'big')) {
            assert.ok(!call.details.includes('[log:'), `a call that was not replaced must not be tagged: ${call.details}`);
        }
    });
});

test('without a log-accepting exporter nothing is tagged, however large the details', () => {
    withTrackedExecution(() => {
        log.audit({ title: 'big', details: 'x'.repeat(9000) });
    });

    assert.ok(nsLogCalls.length >= 3);
    for (const call of nsLogCalls) {
        assert.ok(!call.details.includes('[log:'), `unexpected tag in: ${call.details.slice(0, 80)}`);
    }
});
