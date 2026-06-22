const assert = require('node:assert/strict');
const test = require('node:test');

const executionTracking = require('../dist/execution-tracking');
const functionContext = require('../dist/function-context');

function startExecution() {
    return executionTracking.startTrackedScriptExecution({
        scopeKey: 'scope',
        entryKind: 'restlet',
        entryKey: 'post',
        filePath: 'router.ts',
        modulePath: 'router',
        scriptType: 'restlet',
    });
}

function observedFunctions() {
    return executionTracking.getActiveTrackedExecutionSnapshot().observedFunctions;
}

test('recordFunctionInvocation keys by parent so one function under two parents yields two edges', () => {
    const snapshot = startExecution();

    try {
        const child = { functionName: 'helper', modulePath: 'mod', filePath: 'mod.ts', functionContext: '', instrumentationSource: 'test' };
        executionTracking.recordFunctionInvocation(child, 1000, 1100, 0, 0, { parentFunctionName: 'alpha', parentModulePath: 'modA' });
        executionTracking.recordFunctionInvocation(child, 1200, 1300, 0, 0, { parentFunctionName: 'beta', parentModulePath: 'modB' });

        const helpers = observedFunctions().filter((entry) => entry.functionName === 'helper');
        assert.equal(helpers.length, 2);
        const parents = helpers.map((entry) => entry.parentFunctionName).sort();
        assert.deepEqual(parents, ['alpha', 'beta']);
    } finally {
        executionTracking.finishTrackedScriptExecution(snapshot.executionId);
    }
});

test('withFunctionContext captures the immediate caller as the parent of a nested call', () => {
    const snapshot = startExecution();

    try {
        functionContext.withFunctionContext(
            { functionName: 'outer', modulePath: 'modOuter', filePath: 'modOuter.ts', functionContext: '', instrumentationSource: 'test' },
            () => functionContext.withFunctionContext(
                { functionName: 'inner', modulePath: 'modInner', filePath: 'modInner.ts', functionContext: '', instrumentationSource: 'test' },
                () => 'done',
            ),
        );

        const inner = observedFunctions().find((entry) => entry.functionName === 'inner');
        assert.equal(inner.parentFunctionName, 'outer');
        assert.equal(inner.parentModulePath, 'modOuter');

        const outer = observedFunctions().find((entry) => entry.functionName === 'outer');
        assert.equal(outer.parentFunctionName, '');
    } finally {
        executionTracking.finishTrackedScriptExecution(snapshot.executionId);
    }
});
