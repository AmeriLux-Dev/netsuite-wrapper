const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

// performance-tracker resolves N/ modules lazily via the ambient `require`, which routes
// through Module._load. Intercept 'N/format' so we can drive the timezone conversion without
// a live SuiteScript runtime.
let fakeFormat = null;
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'N/format') {
        if (!fakeFormat) {
            throw new Error('N/format not available');
        }

        return fakeFormat;
    }

    return originalLoad.call(this, request, parent, isMain);
};

const performanceTracker = require('../dist/performance-tracker');

test.afterEach(() => {
    fakeFormat = null;
});

test('formatTimestamp re-expresses the instant in the user preferred timezone via N/format', () => {
    const calls = [];
    fakeFormat = {
        Type: { DATETIMETZ: 'datetimetz', DATETIME: 'datetime' },
        format(options) {
            calls.push(options.type);
            // DATETIMETZ with no explicit timezone => user preference. Simulate the user-tz
            // wall clock being two hours ahead of the raw instant's server-local reading.
            assert.equal(options.type, 'datetimetz');
            assert.equal(options.timezone, undefined);
            return 'user-tz-wall-clock';
        },
        parse(options) {
            calls.push(options.type);
            assert.equal(options.type, 'datetime');
            assert.equal(options.value, 'user-tz-wall-clock');
            // A Date built from local components reads those components back regardless of the
            // test machine's timezone, keeping the assertion deterministic.
            return new Date(2026, 5, 26, 14, 30, 0);
        },
    };

    // The raw instant differs from the converted wall clock; the result must reflect conversion.
    const result = performanceTracker.formatTimestamp(new Date(Date.UTC(2026, 5, 26, 19, 30, 0)));

    assert.equal(result, '2026-06-26 14:30:00');
    assert.deepEqual(calls, ['datetimetz', 'datetime']);
});

test('formatTimestamp falls back to server-local formatting when N/format is unavailable', () => {
    fakeFormat = null; // getNsFormat() will throw inside the conversion helper.

    // Built from local components so the fallback assertion is timezone-independent.
    const result = performanceTracker.formatTimestamp(new Date(2030, 0, 2, 3, 4, 5));

    assert.equal(result, '2030-01-02 03:04:05');
});
