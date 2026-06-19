const assert = require('node:assert/strict');
const test = require('node:test');

const { forwardModuleExports } = require('../dist/lazy-module');

test('forwardModuleExports forwards un-instrumented members and preserves instrumented ones', () => {
    const realModule = {
        create: () => 'real-create',
        runSuiteQLPaged: () => 'paged',
        Type: { CUSTOMER: 'customer' },
    };
    const target = { create: () => 'wrapped-create' };

    forwardModuleExports(target, () => realModule);

    // An explicitly instrumented export must be preserved, not overwritten by the passthrough.
    assert.equal(target.create(), 'wrapped-create');
    // Members the wrapper does not instrument must be forwarded to the real module.
    assert.equal(typeof target.runSuiteQLPaged, 'function');
    assert.equal(target.runSuiteQLPaged(), 'paged');
    assert.deepEqual(target.Type, { CUSTOMER: 'customer' });
});

test('forwardModuleExports re-reads the live module on each access', () => {
    let current = { value: 1 };
    const target = {};

    forwardModuleExports(target, () => current);
    assert.equal(target.value, 1);

    current = { value: 2 };
    assert.equal(target.value, 2);
});
