const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const log = require('../dist/log');
const executionTracking = require('../dist/execution-tracking');

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

test('trace logging is disabled by default', () => {
    assert.equal(log.isTraceLogEnabled(), false);
});

test('setTraceLogEnabled(true) turns trace logging on', () => {
    log.setTraceLogEnabled(true);
    try {
        assert.equal(log.isTraceLogEnabled(), true);
    } finally {
        log.setTraceLogEnabled(false);
    }
});

test('setTraceLogEnabled(false) turns trace logging back off', () => {
    log.setTraceLogEnabled(true);
    log.setTraceLogEnabled(false);
    assert.equal(log.isTraceLogEnabled(), false);
});

test('chunk log mode defaults to group', () => {
    assert.equal(log.getChunkLogMode(), 'group');
});

test('setChunkLogMode accepts valid modes and coerces unknown values to group', () => {
    try {
        log.setChunkLogMode('off');
        assert.equal(log.getChunkLogMode(), 'off');
        log.setChunkLogMode('silent');
        assert.equal(log.getChunkLogMode(), 'silent');
        log.setChunkLogMode('nonsense');
        assert.equal(log.getChunkLogMode(), 'group');
    } finally {
        log.setChunkLogMode('group');
    }
});

test('moves the execution tag into the detail and keeps the title clean', () => {
    nsLogCalls.length = 0;

    const snapshot = withTrackedExecution((active) => {
        log.audit('Hello world', { foo: 1 });
        return active;
    });

    assert.equal(nsLogCalls.length, 1);
    assert.equal(nsLogCalls[0].title, 'Hello world');
    assert.ok(
        nsLogCalls[0].details.startsWith(`[${snapshot.executionId}] `),
        `detail should start with the execution tag, got: ${nsLogCalls[0].details}`,
    );
    assert.match(nsLogCalls[0].details, /\{"foo":1\}/);
});

test('group mode replicates the tracker prefix in every chunk after the marker', () => {
    nsLogCalls.length = 0;
    const body = 'x'.repeat(9000);

    let executionId = '';
    withTrackedExecution((active) => {
        executionId = active.executionId;
        log.audit('Big', body);
    });

    assert.ok(nsLogCalls.length >= 2, `expected multiple chunks, got ${nsLogCalls.length}`);

    const chunkPrefix = new RegExp(`^\\[\\[NSW_CHUNK\\|[A-Za-z0-9_-]+\\|\\d+/\\d+\\]\\] \\[${executionId}\\] `);
    let reconstructed = '';
    for (const call of nsLogCalls) {
        assert.equal(call.title, 'Big');
        const match = chunkPrefix.exec(call.details);
        assert.ok(match, `chunk detail missing marker+exec prefix: ${call.details.slice(0, 80)}`);
        reconstructed += call.details.slice(match[0].length);
    }

    assert.equal(reconstructed, body);
});

test('off mode emits a single entry with the full prefixed detail and no marker', () => {
    nsLogCalls.length = 0;
    const body = 'z'.repeat(9000);

    let executionId = '';
    log.setChunkLogMode('off');
    try {
        withTrackedExecution((active) => {
            executionId = active.executionId;
            log.audit('Big', body);
        });
    } finally {
        log.setChunkLogMode('group');
    }

    assert.equal(nsLogCalls.length, 1);
    assert.ok(!nsLogCalls[0].details.includes('NSW_CHUNK'), 'off mode must not include the chunk marker');
    assert.equal(nsLogCalls[0].details, `[${executionId}] ${body}`);
});

test('silent mode splits without the chunk marker but keeps the prefix per entry', () => {
    nsLogCalls.length = 0;
    const body = 'y'.repeat(9000);

    let executionId = '';
    log.setChunkLogMode('silent');
    try {
        withTrackedExecution((active) => {
            executionId = active.executionId;
            log.audit('Big', body);
        });
    } finally {
        log.setChunkLogMode('group');
    }

    assert.ok(nsLogCalls.length >= 2, `expected multiple entries, got ${nsLogCalls.length}`);

    const prefix = `[${executionId}] `;
    let reconstructed = '';
    for (const call of nsLogCalls) {
        assert.ok(!call.details.includes('NSW_CHUNK'), 'silent mode must not include the chunk marker');
        assert.ok(call.details.startsWith(prefix), `expected prefix, got: ${call.details.slice(0, 40)}`);
        reconstructed += call.details.slice(prefix.length);
    }

    assert.equal(reconstructed, body);
});
