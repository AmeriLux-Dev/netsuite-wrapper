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
    function cloneFunctionContext(context) {
        return __assign({}, context);
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
        var didCleanup = false;
        var cleanup = function () {
            if (didCleanup) {
                return;
            }
            didCleanup = true;
            removeFunctionContext(trackedContext);
        };
        functionContextStack.push(trackedContext);
        (0, execution_tracking_1.recordFunctionInvocation)(trackedContext);
        try {
            var result = work();
            if (result && typeof result.then === 'function') {
                var asyncResult = result;
                return asyncResult.then(function (value) {
                    cleanup();
                    return value;
                }, function (error) {
                    cleanup();
                    throw error;
                });
            }
            cleanup();
            return result;
        }
        catch (error) {
            cleanup();
            throw error;
        }
    }
});
