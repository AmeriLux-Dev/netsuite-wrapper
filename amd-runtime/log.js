define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isTraceLogEnabled = isTraceLogEnabled;
    exports.setTraceLogEnabled = setTraceLogEnabled;
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
    function buildTrackerTitlePrefix(snapshot, activeFunctionContext) {
        var executionTitlePrefix = (snapshot === null || snapshot === void 0 ? void 0 : snapshot.executionId) ? "[".concat(snapshot.executionId, "] ") : '';
        var functionTitlePrefix = buildTrackerFunctionTitleTag(activeFunctionContext);
        return "".concat(executionTitlePrefix).concat(functionTitlePrefix);
    }
    function serializeTitleForLog(title, trackerTitlePrefix) {
        if (!trackerTitlePrefix) {
            return title;
        }
        if (title.startsWith(trackerTitlePrefix)) {
            return title;
        }
        return "".concat(trackerTitlePrefix).concat(title);
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
    function splitDetailIntoChunks(detailText) {
        if (detailText.length <= MAX_CHUNK_DETAIL_LENGTH) {
            return [detailText];
        }
        var groupId = createChunkGroupId();
        var estimatedTotal = Math.max(2, Math.ceil(detailText.length / (MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, 1, 2).length)));
        while (true) {
            var chunkCapacity = MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, estimatedTotal, estimatedTotal).length;
            if (chunkCapacity <= 0) {
                return [detailText.slice(0, MAX_CHUNK_DETAIL_LENGTH)];
            }
            var actualTotal = Math.ceil(detailText.length / chunkCapacity);
            if (actualTotal === estimatedTotal) {
                var chunks = [];
                for (var index = 0; index < actualTotal; index += 1) {
                    var token = buildChunkToken(groupId, index + 1, actualTotal);
                    var payloadStart = index * chunkCapacity;
                    var payloadEnd = payloadStart + chunkCapacity;
                    chunks.push("".concat(token).concat(detailText.slice(payloadStart, payloadEnd)));
                }
                return chunks;
            }
            estimatedTotal = actualTotal;
        }
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
        var trackerTitlePrefix = buildTrackerTitlePrefix(activeExecution, activeFunctionContext);
        var titleText = serializeTitleForLog(normalizedCall.title, trackerTitlePrefix);
        var detailText = serializeDetailsForLog(normalizedCall.details);
        var detailChunks = splitDetailIntoChunks(detailText);
        emitTraceLog('emitLog', {
            method: method,
            inputTitle: normalizedCall.title,
            executionId: (activeExecution === null || activeExecution === void 0 ? void 0 : activeExecution.executionId) || '',
            flowId: (activeExecution === null || activeExecution === void 0 ? void 0 : activeExecution.flowId) || '',
            activeFunction: (activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.functionName) || '',
            activeModule: (activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.modulePath) || (activeFunctionContext === null || activeFunctionContext === void 0 ? void 0 : activeFunctionContext.filePath) || '',
            trackerTitlePrefix: trackerTitlePrefix,
            finalTitle: titleText,
            detailLength: detailText.length,
            chunkCount: detailChunks.length,
        });
        if (detailChunks.length === 1 && detailText.length <= MAX_CHUNK_DETAIL_LENGTH) {
            nsLog[method]({
                title: titleText,
                details: detailText,
            });
            return;
        }
        for (var _i = 0, detailChunks_1 = detailChunks; _i < detailChunks_1.length; _i++) {
            var chunk = detailChunks_1[_i];
            nsLog[method]({
                title: titleText,
                details: chunk,
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
