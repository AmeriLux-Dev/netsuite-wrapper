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
define(["require", "exports", "./fail-open", "./lazy-module"], function (require, exports, fail_open_1, lazy_module_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isTraceLogEnabled = isTraceLogEnabled;
    exports.setTraceLogEnabled = setTraceLogEnabled;
    exports.getChunkLogMode = getChunkLogMode;
    exports.setChunkLogMode = setChunkLogMode;
    exports.debug = debug;
    exports.audit = audit;
    exports.error = error;
    exports.emergency = emergency;
    var LOG_CHUNK_MARKER = '[[NSW_CHUNK';
    var MAX_CHUNK_DETAIL_LENGTH = 3980;
    function getNsLog() {
        return require('N/log');
    }
    function getNsRuntime() {
        return require('N/runtime');
    }
    var traceLogEnabled = false;
    function isTraceLogEnabled() {
        return traceLogEnabled;
    }
    function setTraceLogEnabled(enabled) {
        traceLogEnabled = enabled === true;
    }
    var chunkLogMode = 'group';
    function getChunkLogMode() {
        return chunkLogMode;
    }
    function setChunkLogMode(mode) {
        chunkLogMode = mode === 'silent' || mode === 'off' ? mode : 'group';
    }
    function emitTraceLog(stage, details) {
        if (!traceLogEnabled) {
            return;
        }
        try {
            getNsLog().audit({
                title: "[NSW_TRACE] ".concat(stage),
                details: stringifyDetails(details),
            });
        }
        catch (_error) {
            // Trace logging must never block the real log path.
        }
    }
    function getActiveTrackedExecutionSnapshot() {
        try {
            var executionTracking = require('./execution-tracking');
            return executionTracking.getActiveTrackedExecutionSnapshot();
        }
        catch (error) {
            emitTraceLog('getActiveTrackedExecutionSnapshot.error', {
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
    function getActiveFunctionContext() {
        try {
            var functionContext = require('./function-context');
            return functionContext.getActiveFunctionContext();
        }
        catch (error) {
            emitTraceLog('getActiveFunctionContext.error', {
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
    // Builds the structured entry exporters receive and queues it on the active run. Only runs when a
    // tracked execution is active (otherwise there is no run to batch with) and only when some exporter
    // wants log entries (otherwise the argument snapshot would be paid for nothing). The N/log write
    // happens regardless; this is the second destination, never a replacement.
    function forwardLogEntry(method, normalizedCall, activeExecution, activeFunctionContext) {
        if (!(activeExecution === null || activeExecution === void 0 ? void 0 : activeExecution.executionId)) {
            return;
        }
        try {
            var telemetryExporter = require('./telemetry-exporter');
            if (!telemetryExporter.hasLogAcceptingTelemetryExporter()) {
                return;
            }
            var functionContext = require('./function-context');
            var scriptId = '';
            var deploymentId = '';
            try {
                var currentScript = getNsRuntime().getCurrentScript();
                scriptId = normalizeTitle(currentScript.id);
                deploymentId = normalizeTitle(currentScript.deploymentId);
            }
            catch (_runtimeError) {
                // Outside SuiteScript there is no current script.
            }
            // The entry names the innermost application function (wrapper-internal and infrastructure
            // frames skipped), the same frame whose arguments are snapshotted; the N/log tag keeps
            // using the raw top of the stack as before.
            var preferredFunctionContext = functionContext.getPreferredActiveFunctionContext() || activeFunctionContext;
            var functionArguments = functionContext.snapshotActiveFunctionArguments();
            telemetryExporter.enqueueTelemetryLogEntry(activeExecution.executionId, __assign({ level: method, title: normalizedCall.title, details: normalizedCall.details === undefined ? null : normalizedCall.details, timestamp: new Date().toISOString(), executionId: activeExecution.executionId, flowId: activeExecution.flowId || '', scriptId: scriptId, deploymentId: deploymentId, functionName: normalizeTitle(preferredFunctionContext === null || preferredFunctionContext === void 0 ? void 0 : preferredFunctionContext.functionName), functionModulePath: normalizeTitle((preferredFunctionContext === null || preferredFunctionContext === void 0 ? void 0 : preferredFunctionContext.modulePath) || (preferredFunctionContext === null || preferredFunctionContext === void 0 ? void 0 : preferredFunctionContext.filePath)), callChain: functionContext.getFunctionCallChainLabel() }, (functionArguments ? { functionArguments: functionArguments } : {})));
        }
        catch (error) {
            emitTraceLog('forwardLogEntry.error', {
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    function normalizeTitle(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value);
    }
    function stringifyDetails(value) {
        if (value === null || value === undefined) {
            return '';
        }
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        }
        catch (_error) {
            return String(value);
        }
    }
    function buildTrackerFunctionTitleTag(activeFunctionContext) {
        var activeFunctionName = normalizeTitle(activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.functionName);
        var activeFunctionModulePath = normalizeTitle((activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.modulePath) || (activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.filePath));
        if (!activeFunctionName) {
            return '';
        }
        return activeFunctionModulePath
            ? "[fn:".concat(activeFunctionName, "::").concat(activeFunctionModulePath, "] ")
            : "[fn:".concat(activeFunctionName, "] ");
    }
    function buildTrackerDetailPrefix(snapshot, activeFunctionContext) {
        var executionTag = (snapshot === null || snapshot === void 0 ? void 0 : snapshot.executionId) ? "[".concat(snapshot.executionId, "] ") : '';
        var functionTag = buildTrackerFunctionTitleTag(activeFunctionContext);
        return "".concat(executionTag).concat(functionTag);
    }
    function serializeDetailsForLog(details) {
        return stringifyDetails(details);
    }
    function createChunkGroupId() {
        var timestamp = Date.now().toString(36);
        var randomComponent = Math.floor(Math.random() * 0xffffff).toString(36).padStart(4, '0');
        return "".concat(timestamp).concat(randomComponent);
    }
    function buildChunkToken(groupId, index, total) {
        return "".concat(LOG_CHUNK_MARKER, "|").concat(groupId, "|").concat(index, "/").concat(total, "]] ");
    }
    function splitBodyIntoSlices(detailBody, capacity) {
        if (capacity <= 0) {
            return [detailBody];
        }
        var slices = [];
        for (var start = 0; start < detailBody.length; start += capacity) {
            slices.push(detailBody.slice(start, start + capacity));
        }
        return slices.length === 0 ? [''] : slices;
    }
    function buildSilentChunks(detailPrefix, detailBody) {
        var capacity = MAX_CHUNK_DETAIL_LENGTH - detailPrefix.length;
        return splitBodyIntoSlices(detailBody, capacity).map(function (slice) { return "".concat(detailPrefix).concat(slice); });
    }
    function buildGroupedChunks(detailPrefix, detailBody) {
        var groupId = createChunkGroupId();
        var estimatedTotal = Math.max(2, Math.ceil(detailBody.length / Math.max(1, MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, 1, 2).length - detailPrefix.length)));
        while (true) {
            var chunkCapacity = MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, estimatedTotal, estimatedTotal).length - detailPrefix.length;
            if (chunkCapacity <= 0) {
                var token = buildChunkToken(groupId, 1, 1);
                var capacity = Math.max(0, MAX_CHUNK_DETAIL_LENGTH - token.length - detailPrefix.length);
                return ["".concat(token).concat(detailPrefix).concat(detailBody.slice(0, capacity))];
            }
            var actualTotal = Math.ceil(detailBody.length / chunkCapacity);
            if (actualTotal === estimatedTotal) {
                var chunks = [];
                for (var index = 0; index < actualTotal; index += 1) {
                    var token = buildChunkToken(groupId, index + 1, actualTotal);
                    var payloadStart = index * chunkCapacity;
                    var payloadEnd = payloadStart + chunkCapacity;
                    chunks.push("".concat(token).concat(detailPrefix).concat(detailBody.slice(payloadStart, payloadEnd)));
                }
                return chunks;
            }
            estimatedTotal = actualTotal;
        }
    }
    function buildDetailLines(detailPrefix, detailBody) {
        var combined = "".concat(detailPrefix).concat(detailBody);
        if (chunkLogMode === 'off' || combined.length <= MAX_CHUNK_DETAIL_LENGTH) {
            return [combined];
        }
        if (chunkLogMode === 'silent') {
            return buildSilentChunks(detailPrefix, detailBody);
        }
        return buildGroupedChunks(detailPrefix, detailBody);
    }
    function normalizeLogCall(titleOrOptions, details) {
        if (typeof titleOrOptions === 'string') {
            return {
                title: titleOrOptions,
                details: details,
            };
        }
        return {
            title: normalizeTitle(titleOrOptions.title),
            details: titleOrOptions.details,
        };
    }
    function emitLog(method, titleOrOptions, details) {
        var nsLog = getNsLog();
        var normalizedCall;
        var activeExecution;
        var activeFunctionContext;
        var detailPrefix;
        var titleText;
        var detailBody;
        var detailLines;
        try {
            normalizedCall = normalizeLogCall(titleOrOptions, details);
            activeExecution = getActiveTrackedExecutionSnapshot();
            activeFunctionContext = getActiveFunctionContext();
            detailPrefix = buildTrackerDetailPrefix(activeExecution, activeFunctionContext);
            titleText = normalizedCall.title;
            detailBody = serializeDetailsForLog(normalizedCall.details);
            detailLines = buildDetailLines(detailPrefix, detailBody);
        }
        catch (error) {
            // The call is logged as the application made it, without tags or chunking.
            (0, fail_open_1.reportWrapperFailure)('log', error);
            nsLog[method](titleOrOptions, details);
            return;
        }
        emitTraceLog('emitLog', {
            method: method,
            inputTitle: normalizedCall.title,
            executionId: (activeExecution === null || activeExecution === void 0 ? void 0 : activeExecution.executionId) || '',
            flowId: (activeExecution === null || activeExecution === void 0 ? void 0 : activeExecution.flowId) || '',
            activeFunction: (activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.functionName) || '',
            activeModule: (activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.modulePath) || (activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.filePath) || '',
            detailPrefix: detailPrefix,
            title: titleText,
            detailLength: detailBody.length,
            chunkMode: chunkLogMode,
            chunkCount: detailLines.length,
        });
        for (var _i = 0, detailLines_1 = detailLines; _i < detailLines_1.length; _i++) {
            var line = detailLines_1[_i];
            nsLog[method]({
                title: titleText,
                details: line,
            });
        }
        forwardLogEntry(method, normalizedCall, activeExecution, activeFunctionContext);
    }
    function debug(titleOrOptions, details) {
        emitLog('debug', titleOrOptions, details);
    }
    function audit(titleOrOptions, details) {
        emitLog('audit', titleOrOptions, details);
    }
    function error(titleOrOptions, details) {
        emitLog('error', titleOrOptions, details);
    }
    function emergency(titleOrOptions, details) {
        emitLog('emergency', titleOrOptions, details);
    }
    // Last, so every export above is in place: anything N/log answers that is not instrumented here passes through.
    (0, lazy_module_1.forwardModuleExports)(exports, getNsLog);
});
