const assert = require('node:assert/strict');
const test = require('node:test');

const { snapshotValue, snapshotFunctionArguments } = require('../dist/value-snapshot');

test('scalars pass through and undefined becomes null', () => {
    assert.equal(snapshotValue(12), 12);
    assert.equal(snapshotValue(true), true);
    assert.equal(snapshotValue('short'), 'short');
    assert.equal(snapshotValue(undefined), null);
    assert.equal(snapshotValue(null), null);
    assert.equal(snapshotValue(NaN), 'NaN');
});

test('long strings are cut and report how much was dropped', () => {
    const snapshot = snapshotValue('x'.repeat(250), { maxStringLength: 200 });
    assert.match(snapshot, /^x{200}… \(\+50 chars\)$/);
});

test('arrays keep the first items and count the rest', () => {
    const snapshot = snapshotValue([1, 2, 3, 4, 5, 6, 7], { maxArrayLength: 5 });
    assert.deepEqual(snapshot, [1, 2, 3, 4, 5, '… 2 more']);
});

test('objects are trimmed to a few keys and a couple of levels', () => {
    const snapshot = snapshotValue({ a: { b: { c: { d: 1 } } }, list: [[1], 2] }, { maxDepth: 2 });
    assert.deepEqual(snapshot, { a: { b: '[object]' }, list: ['[array 1]', 2] });

    const wide = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index]));
    const wideSnapshot = snapshotValue(wide, { maxObjectKeys: 20 });
    assert.equal(Object.keys(wideSnapshot).length, 21);
    assert.equal(wideSnapshot['…'], '5 more keys');
});

test('circular references, functions, dates and errors are summarised, not walked', () => {
    const circular = { name: 'loop' };
    circular.self = circular;
    assert.deepEqual(snapshotValue(circular), { name: 'loop', self: '[circular]' });
    assert.equal(snapshotValue(function doWork() {}), '[function doWork]');
    assert.equal(snapshotValue(new Date('2026-09-15T12:00:00.000Z')), '2026-09-15T12:00:00.000Z');
    assert.deepEqual(snapshotValue(new TypeError('bad')), { errorName: 'TypeError', message: 'bad' });
});

test('anything with getValue (a NetSuite record or search result) collapses to type and id', () => {
    const record = { type: 'salesorder', id: 42, getValue() { return 'never read'; }, huge: 'x'.repeat(10000) };
    assert.deepEqual(snapshotValue(record), { recordType: 'salesorder', id: 42 });
    const result = { recordType: 'employee', id: '7', getValue() {} };
    assert.deepEqual(snapshotValue(result), { recordType: 'employee', id: '7' });
});

test('the whole snapshot stays under the total budget by tightening the limits', () => {
    const value = { items: Array.from({ length: 5 }, () => ({ text: 'y'.repeat(200), more: 'z'.repeat(200) })) };
    const snapshot = snapshotValue(value, { maxTotalLength: 600 });
    assert.ok(JSON.stringify(snapshot).length <= 600, 'snapshot must respect maxTotalLength');
});

test('function arguments are named by parameter, with arg<index> for unnamed ones', () => {
    const snapshot = snapshotFunctionArguments(['id', 'options'], [12, { dryRun: true }, 'extra']);
    assert.deepEqual(snapshot, { id: 12, options: { dryRun: true }, arg2: 'extra' });
});
