var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
define(["require", "exports", "./execution-tracking", "./value-snapshot", "./fail-open"], function (require, exports, execution_tracking_1, value_snapshot_1, fail_open_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getActiveFunctionContext = getActiveFunctionContext;
    exports.getPreferredActiveFunctionContext = getPreferredActiveFunctionContext;
    exports.getFunctionContextStack = getFunctionContextStack;
    exports.snapshotActiveFunctionArguments = snapshotActiveFunctionArguments;
    exports.getFunctionCallChainLabel = getFunctionCallChainLabel;
    exports.withFunctionContext = withFunctionContext;
    var functionContextStack = [];
    // Argument values live beside the stack, never on the context object: contexts are cloned into
    // snapshots and span details, and raw arguments (records, large arrays) must not travel with them.
    // They are only read, and only then serialized, when a log call or an error asks for them.
    var argumentValuesByContext = new WeakMap();
    var cachedRuntime = null;
    function cloneFunctionContext(context) {
        return __assign({}, context);
    }
    function isPromiseLike(value) {
        return Boolean(value) && typeof value.then === 'function';
    }
    function loadRuntimeModule() {
        var loaded = require('N/runtime');
        cachedRuntime = loaded;
        return loaded;
    }
    // Reads remaining governance units for the current script. Returns 0 when N/runtime is unavailable
    // (e.g. outside SuiteScript / in tests) so callers can treat 0 as "not captured".
    function readRemainingUsage() {
        try {
            var runtimeModule = cachedRuntime !== null && cachedRuntime !== void 0 ? cachedRuntime : loadRuntimeModule();
            var remaining = runtimeModule.getCurrentScript().getRemainingUsage();
            return typeof remaining === 'number' && remaining > 0 ? remaining : 0;
        }
        catch (_error) {
            return 0;
        }
    }
    function removeFunctionContext(context) {
        var contextIndex = functionContextStack.lastIndexOf(context);
        if (contextIndex !== -1) {
            functionContextStack.splice(contextIndex, 1);
        }
    }
    function getActiveFunctionContext() {
        var activeContext = functionContextStack[functionContextStack.length - 1];
        return activeContext ? cloneFunctionContext(activeContext) : null;
    }
    function isWrapperAdapterContext(context) {
        var modulePath = context.modulePath || context.filePath || '';
        return modulePath.startsWith('netsuite-wrapper/')
            || modulePath.includes('/netsuite-wrapper/');
    }
    function isInfrastructureContext(context) {
        return Boolean(context.excludeFromObservedFunctions);
    }
    function getPreferredActiveFunctionContext() {
        for (var index = functionContextStack.length - 1; index >= 0; index -= 1) {
            var context = functionContextStack[index];
            if (!isWrapperAdapterContext(context) && !isInfrastructureContext(context)) {
                return cloneFunctionContext(context);
            }
        }
        for (var index = functionContextStack.length - 1; index >= 0; index -= 1) {
            var context = functionContextStack[index];
            if (!isInfrastructureContext(context)) {
                return cloneFunctionContext(context);
            }
        }
        var activeContext = functionContextStack[functionContextStack.length - 1];
        return activeContext ? cloneFunctionContext(activeContext) : null;
    }
    function getFunctionContextStack() {
        return functionContextStack.map(cloneFunctionContext);
    }
    function snapshotContextArguments(context) {
        var argumentValues = argumentValuesByContext.get(context);
        if (!argumentValues) {
            return undefined;
        }
        try {
            return (0, value_snapshot_1.snapshotFunctionArguments)(context.parameterNames || [], argumentValues);
        }
        catch (_error) {
            return undefined;
        }
    }
    /**
     * The arguments of the innermost instrumented application function, snapshotted now. Wrapper-internal
     * and infrastructure frames are skipped, the same way the log tag picks its function. Undefined when
     * nothing is on the stack or that function opted out of argument capture.
     */
    function snapshotActiveFunctionArguments() {
        for (var index = functionContextStack.length - 1; index >= 0; index -= 1) {
            var context = functionContextStack[index];
            if (!isWrapperAdapterContext(context) && !isInfrastructureContext(context)) {
                return snapshotContextArguments(context);
            }
        }
        return undefined;
    }
    /** The instrumented functions currently on the stack, outermost first, as `name -> name -> name`. */
    function getFunctionCallChainLabel() {
        return functionContextStack
            .filter(function (context) { return !isWrapperAdapterContext(context) && !isInfrastructureContext(context); })
            .map(function (context) { return context.functionName; })
            .filter(Boolean)
            .join(' -> ');
    }
    /**
     * Runs an instrumented application function inside its function context. The bookkeeping runs
     * inside observe(): if it fails, the function still runs once and its result or error reaches the
     * caller unchanged.
     */
    function withFunctionContext(context, work, argumentValues) {
        return (0, fail_open_1.observe)(work, function (observedWork) { return trackFunctionCall(context, observedWork, argumentValues); });
    }
    function trackFunctionCall(context, work, argumentValues) {
        var trackedContext = cloneFunctionContext(context);
        var parentContext = getPreferredActiveFunctionContext();
        var startedAt = Date.now();
        var startUsage = readRemainingUsage();
        var didFinish = false;
        if (argumentValues) {
            argumentValuesByContext.set(trackedContext, argumentValues);
        }
        var finish = function () {
            if (didFinish) {
                return;
            }
            didFinish = true;
            (0, execution_tracking_1.recordFunctionInvocation)(trackedContext, startedAt, Date.now(), startUsage, readRemainingUsage(), {
                parentFunctionName: parentContext === null || parentContext === void 0 ? void 0 : parentContext.functionName,
                parentModulePath: (parentContext === null || parentContext === void 0 ? void 0 : parentContext.modulePath) || (parentContext === null || parentContext === void 0 ? void 0 : parentContext.filePath),
            });
            removeFunctionContext(trackedContext);
        };
        var fail = function (error) {
            // Arguments are serialised only when a tracked run will keep the record; an untracked
            // script pays nothing extra on its error path.
            if ((0, execution_tracking_1.hasActiveTrackedExecution)()) {
                try {
                    (0, execution_tracking_1.recordFunctionError)(trackedContext, error, snapshotContextArguments(trackedContext));
                }
                catch (_recordError) {
                    // Recording the failure must never replace the failure.
                }
            }
            finish();
        };
        functionContextStack.push(trackedContext);
        try {
            var result = work();
            if (isPromiseLike(result)) {
                return result.then(function (value) {
                    finish();
                    return value;
                }, function (error) {
                    fail(error);
                    throw error;
                });
            }
            finish();
            return result;
        }
        catch (error) {
            fail(error);
            throw error;
        }
    }
});
