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
define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getActiveTrackedExecutionSnapshot = getActiveTrackedExecutionSnapshot;
    exports.startTrackedScriptExecution = startTrackedScriptExecution;
    exports.finishTrackedScriptExecution = finishTrackedScriptExecution;
    exports.recordFunctionInvocation = recordFunctionInvocation;
    var trackedExecutionStack = [];
    function normalizeText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }
    function normalizePositive(value) {
        return Number.isFinite(value) && value > 0 ? value : 0;
    }
    function makeId(prefix, startedAt) {
        var randomComponent = Math.floor(Math.random() * 0xffffff).toString(36);
        return "".concat(prefix, "_").concat(startedAt.getTime().toString(36), "_").concat(randomComponent);
    }
    function createFlowId(executionId) {
        return "flow_".concat(executionId);
    }
    function cloneObservedFunctionSummary(summary) {
        return __assign({}, summary);
    }
    function toSnapshot(state) {
        return {
            executionId: state.executionId,
            flowId: state.flowId,
            scopeKey: state.scopeKey,
            entryKind: state.entryKind,
            entryKey: state.entryKey,
            filePath: state.filePath,
            modulePath: state.modulePath,
            scriptType: state.scriptType,
            observedFunctions: Array.from(state.observedFunctions.values())
                .map(cloneObservedFunctionSummary)
                .sort(function (left, right) {
                if (right.count !== left.count) {
                    return right.count - left.count;
                }
                if (left.modulePath !== right.modulePath) {
                    return left.modulePath.localeCompare(right.modulePath);
                }
                return left.functionName.localeCompare(right.functionName);
            }),
        };
    }
    function getActiveTrackedExecutionSnapshot() {
        var activeExecution = trackedExecutionStack[trackedExecutionStack.length - 1];
        return activeExecution ? toSnapshot(activeExecution) : null;
    }
    function startTrackedScriptExecution(metadata, startedAt) {
        if (startedAt === void 0) { startedAt = new Date(); }
        var executionId = makeId('exec', startedAt);
        var activeExecution = {
            executionId: executionId,
            flowId: createFlowId(executionId),
            scopeKey: normalizeText(metadata.scopeKey),
            entryKind: normalizeText(metadata.entryKind),
            entryKey: normalizeText(metadata.entryKey),
            filePath: normalizeText(metadata.filePath),
            modulePath: normalizeText(metadata.modulePath),
            scriptType: normalizeText(metadata.scriptType),
            observedFunctions: new Map(),
        };
        trackedExecutionStack.push(activeExecution);
        return toSnapshot(activeExecution);
    }
    function finishTrackedScriptExecution(executionId) {
        if (trackedExecutionStack.length === 0) {
            return null;
        }
        if (!executionId) {
            var activeExecution = trackedExecutionStack.pop();
            return activeExecution ? toSnapshot(activeExecution) : null;
        }
        for (var index = trackedExecutionStack.length - 1; index >= 0; index -= 1) {
            if (trackedExecutionStack[index].executionId === executionId) {
                var activeExecution = trackedExecutionStack.splice(index, 1)[0];
                return activeExecution ? toSnapshot(activeExecution) : null;
            }
        }
        return null;
    }
    function recordFunctionInvocation(context, startedAt, endedAt, startUsage, endUsage, parent) {
        if (startedAt === void 0) { startedAt = 0; }
        if (endedAt === void 0) { endedAt = 0; }
        if (startUsage === void 0) { startUsage = 0; }
        if (endUsage === void 0) { endUsage = 0; }
        if (parent === void 0) { parent = {}; }
        var activeExecution = trackedExecutionStack[trackedExecutionStack.length - 1];
        if (!activeExecution) {
            return;
        }
        if (context.excludeFromObservedFunctions) {
            return;
        }
        var functionName = normalizeText(context.functionName);
        var modulePath = normalizeText(context.modulePath) || normalizeText(context.filePath);
        if (!functionName || !modulePath) {
            return;
        }
        var startMs = normalizePositive(startedAt);
        var endMs = normalizePositive(endedAt);
        var startUnits = normalizePositive(startUsage);
        var endUnits = normalizePositive(endUsage);
        var durationMs = endMs > startMs ? endMs - startMs : 0;
        var usage = startUnits > 0 && endUnits > 0 && startUnits >= endUnits ? startUnits - endUnits : 0;
        var parentFunctionName = normalizeText(parent.parentFunctionName);
        var parentModulePath = normalizeText(parent.parentModulePath);
        var observationKey = "".concat(parentModulePath, "::").concat(parentFunctionName, ">>").concat(modulePath, "::").concat(functionName);
        var existingSummary = activeExecution.observedFunctions.get(observationKey);
        if (existingSummary) {
            existingSummary.count += 1;
            existingSummary.totalDurationMs += durationMs;
            existingSummary.totalUsage += usage;
            existingSummary.startedAt = lowestPositive(existingSummary.startedAt, startMs);
            existingSummary.endedAt = Math.max(existingSummary.endedAt, endMs);
            return;
        }
        activeExecution.observedFunctions.set(observationKey, {
            functionName: functionName,
            modulePath: modulePath,
            filePath: normalizeText(context.filePath),
            count: 1,
            startedAt: startMs,
            endedAt: endMs,
            totalDurationMs: durationMs,
            totalUsage: usage,
            parentFunctionName: parentFunctionName,
            parentModulePath: parentModulePath,
        });
    }
    function lowestPositive(existing, candidate) {
        if (candidate <= 0) {
            return existing;
        }
        if (existing <= 0) {
            return candidate;
        }
        return Math.min(existing, candidate);
    }
});
