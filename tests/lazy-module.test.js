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

test('forwardModuleExports forwards inherited and non-enumerable members', () => {
    const prototype = { inherited: () => 'inherited' };
    const realModule = Object.create(prototype);
    Object.defineProperty(realModule, 'hidden', { value: 'hidden', enumerable: false });
    const target = {};

    forwardModuleExports(target, () => realModule);

    assert.equal(target.inherited(), 'inherited');
    assert.equal(target.hidden, 'hidden');
});

test('forwardModuleExports fills placeholder exports even when the module does not list them', () => {
    // An N module whose members cannot be listed at all: only reads answer.
    const unlistableModule = new Proxy({}, { get: (_target, member) => `N/query.${String(member)}` });
    const target = { Operator: undefined, create: () => 'wrapped-create' };

    forwardModuleExports(target, () => unlistableModule);

    assert.equal(target.Operator, 'N/query.Operator');
    assert.equal(target.create(), 'wrapped-create');
});

test('forwardModuleExports survives a module that cannot be loaded yet, and forwards once it can', () => {
    let realModule = null;
    const target = { Type: undefined };

    forwardModuleExports(target, () => {
        if (!realModule) {
            throw new Error('Module does not exist: N/record');
        }
        return realModule;
    });

    realModule = { Type: { SALES_ORDER: 'salesorder' } };
    assert.deepEqual(target.Type, { SALES_ORDER: 'salesorder' });
});
