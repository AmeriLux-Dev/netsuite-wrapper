const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const nsLogCalls = [];
const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request) {
    if (request === 'N/log') {
        return {
            error: (options) => nsLogCalls.push({ method: 'error', ...options }),
        };
    }

    return originalModuleLoad.apply(this, arguments);
};

const telemetryExporter = require('../dist/telemetry-exporter');

function makeBatch(overrides = {}) {
    return {
        executionId: 'exec_1',
        flowId: 'flow_1',
        scopeKey: 'app:test',
        mode: 'diagnostic',
        spans: [{ executionId: 'exec_1', spanRole: 'entry' }],
        logs: [{ level: 'audit', title: 'hello' }],
        ...overrides,
    };
}

test.beforeEach(() => {
    telemetryExporter.clearTelemetryExporters();
    nsLogCalls.length = 0;
});

test('registering an exporter with an existing name replaces it', () => {
    telemetryExporter.registerTelemetryExporter({ name: 'a', acceptsLogEntries: false, export() {} });
    telemetryExporter.registerTelemetryExporter({ name: 'b', acceptsLogEntries: true, export() {} });
    const replacement = { name: 'a', acceptsLogEntries: true, export() {} };
    telemetryExporter.registerTelemetryExporter(replacement);

    const registered = telemetryExporter.getTelemetryExporters();
    assert.deepEqual(registered.map((exporter) => exporter.name), ['a', 'b']);
    assert.equal(registered[0], replacement);
    assert.equal(telemetryExporter.hasLogAcceptingTelemetryExporter(), true);

    telemetryExporter.unregisterTelemetryExporter('b');
    telemetryExporter.unregisterTelemetryExporter('a');
    assert.equal(telemetryExporter.hasLogAcceptingTelemetryExporter(), false);
});

test('a batch reaches every exporter; exporters that do not accept logs get none', () => {
    const received = [];
    telemetryExporter.registerTelemetryExporter({ name: 'spans-only', acceptsLogEntries: false, export: (batch) => received.push(['spans-only', batch]) });
    telemetryExporter.registerTelemetryExporter({ name: 'everything', acceptsLogEntries: true, export: (batch) => received.push(['everything', batch]) });

    telemetryExporter.dispatchTelemetryBatch(makeBatch());

    assert.equal(received.length, 2);
    assert.deepEqual(received[0][1].logs, []);
    assert.equal(received[0][1].spans.length, 1);
    assert.equal(received[1][1].logs.length, 1);
});

test('one failing exporter is logged and never stops the others', () => {
    const received = [];
    telemetryExporter.registerTelemetryExporter({ name: 'broken', acceptsLogEntries: true, export() { throw new Error('endpoint down'); } });
    telemetryExporter.registerTelemetryExporter({ name: 'fine', acceptsLogEntries: true, export: (batch) => received.push(batch) });

    assert.doesNotThrow(() => telemetryExporter.dispatchTelemetryBatch(makeBatch()));

    assert.equal(received.length, 1);
    assert.equal(nsLogCalls.length, 1);
    assert.equal(nsLogCalls[0].title, 'netsuite-wrapper telemetry export failed');
    assert.match(nsLogCalls[0].details, /"exporter":"broken"/);
    assert.match(nsLogCalls[0].details, /endpoint down/);
});

test('log entries queue per execution and are taken once', () => {
    telemetryExporter.enqueueTelemetryLogEntry('exec_a', { level: 'debug', title: 'one' });
    telemetryExporter.enqueueTelemetryLogEntry('exec_a', { level: 'debug', title: 'two' });
    telemetryExporter.enqueueTelemetryLogEntry('exec_b', { level: 'debug', title: 'other' });
    telemetryExporter.enqueueTelemetryLogEntry('', { level: 'debug', title: 'no execution' });

    assert.deepEqual(telemetryExporter.takeTelemetryLogEntries('exec_a').map((entry) => entry.title), ['one', 'two']);
    assert.deepEqual(telemetryExporter.takeTelemetryLogEntries('exec_a'), []);
    assert.deepEqual(telemetryExporter.takeTelemetryLogEntries('exec_b').map((entry) => entry.title), ['other']);
});

test('a run that logs more than the cap keeps the first entries and reports the rest', () => {
    for (let index = 0; index < 505; index += 1) {
        telemetryExporter.enqueueTelemetryLogEntry('exec_many', { level: 'debug', title: `line ${index}`, executionId: 'exec_many' });
    }

    const entries = telemetryExporter.takeTelemetryLogEntries('exec_many');
    assert.equal(entries.length, 501);
    assert.equal(entries[500].title, 'netsuite-wrapper log entries dropped');
    assert.deepEqual(entries[500].details, { droppedCount: 5, keptCount: 500, limit: 500 });
});
