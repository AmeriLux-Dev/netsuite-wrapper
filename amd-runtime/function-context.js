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
define(["require", "exports", "./execution-tracking"], function (require, exports, execution_tracking_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getActiveFunctionContext = getActiveFunctionContext;
    exports.getPreferredActiveFunctionContext = getPreferredActiveFunctionContext;
    exports.getFunctionContextStack = getFunctionContextStack;
    exports.withFunctionContext = withFunctionContext;
    var functionContextStack = [];
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
    function withFunctionContext(context, work) {
        var trackedContext = cloneFunctionContext(context);
        var parentContext = getPreferredActiveFunctionContext();
        var startedAt = Date.now();
        var startUsage = readRemainingUsage();
        var didFinish = false;
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
        functionContextStack.push(trackedContext);
        try {
            var result = work();
            if (isPromiseLike(result)) {
                return result.then(function (value) {
                    finish();
                    return value;
                }, function (error) {
                    finish();
                    throw error;
                });
            }
            finish();
            return result;
        }
        catch (error) {
            finish();
            throw error;
        }
    }
});
