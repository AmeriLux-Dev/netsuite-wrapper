const assert = require('node:assert/strict');
const test = require('node:test');

const log = require('../dist/log');

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
