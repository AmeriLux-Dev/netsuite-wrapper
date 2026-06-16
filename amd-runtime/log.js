define(["require", "exports"], function (require, exports) {
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
        var normalizedCall = normalizeLogCall(titleOrOptions, details);
        var activeExecution = getActiveTrackedExecutionSnapshot();
        var activeFunctionContext = getActiveFunctionContext();
        var detailPrefix = buildTrackerDetailPrefix(activeExecution, activeFunctionContext);
        var titleText = normalizedCall.title;
        var detailBody = serializeDetailsForLog(normalizedCall.details);
        var detailLines = buildDetailLines(detailPrefix, detailBody);
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
});
