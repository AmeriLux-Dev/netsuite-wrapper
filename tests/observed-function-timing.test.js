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

function findObserved(functionName) {
    const snapshot = executionTracking.getActiveTrackedExecutionSnapshot();
    return snapshot.observedFunctions.find((entry) => entry.functionName === functionName);
}

test('recordFunctionInvocation sums per-invocation duration and keeps the earliest start / latest end', () => {
    const snapshot = startExecution();

    try {
        const context = { functionName: 'doWork', modulePath: 'mod', filePath: 'mod.ts', functionContext: '', instrumentationSource: 'test' };
        executionTracking.recordFunctionInvocation(context, 1000, 1100);
        executionTracking.recordFunctionInvocation(context, 1050, 1300);

        const observed = findObserved('doWork');
        assert.equal(observed.count, 2);
        assert.equal(observed.totalDurationMs, 350);
        assert.equal(observed.startedAt, 1000);
        assert.equal(observed.endedAt, 1300);
    } finally {
        executionTracking.finishTrackedScriptExecution(snapshot.executionId);
    }
});

test('recordFunctionInvocation sums governance consumed (start remaining - end remaining) per invocation', () => {
    const snapshot = startExecution();

    try {
        const context = { functionName: 'usesGov', modulePath: 'mod', filePath: 'mod.ts', functionContext: '', instrumentationSource: 'test' };
        executionTracking.recordFunctionInvocation(context, 1000, 1100, 5000, 4900);
        executionTracking.recordFunctionInvocation(context, 1050, 1300, 4800, 4700);

        const observed = findObserved('usesGov');
        assert.equal(observed.totalUsage, 200);
    } finally {
        executionTracking.finishTrackedScriptExecution(snapshot.executionId);
    }
});

test('withFunctionContext records start and end timestamps for the wrapped call', () => {
    const snapshot = startExecution();

    try {
        functionContext.withFunctionContext(
            { functionName: 'fnA', modulePath: 'modA', filePath: 'modA.ts', functionContext: '', instrumentationSource: 'test' },
            () => 'result',
        );

        const observed = findObserved('fnA');
        assert.equal(observed.count, 1);
        assert.equal(typeof observed.startedAt, 'number');
        assert.equal(typeof observed.endedAt, 'number');
        assert.ok(observed.endedAt >= observed.startedAt);
    } finally {
        executionTracking.finishTrackedScriptExecution(snapshot.executionId);
    }
});
