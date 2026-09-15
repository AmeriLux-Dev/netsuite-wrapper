// The exporter seam. The performance tracker builds spans and the log module builds log entries;
// neither decides where they go. At the end of a tracked script run everything the run produced is
// handed to every registered exporter as one batch, so a remote destination costs one request per
// run rather than one per call.
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
    exports.registerTelemetryExporter = registerTelemetryExporter;
    exports.unregisterTelemetryExporter = unregisterTelemetryExporter;
    exports.clearTelemetryExporters = clearTelemetryExporters;
    exports.getTelemetryExporters = getTelemetryExporters;
    exports.hasLogAcceptingTelemetryExporter = hasLogAcceptingTelemetryExporter;
    exports.enqueueTelemetryLogEntry = enqueueTelemetryLogEntry;
    exports.takeTelemetryLogEntries = takeTelemetryLogEntries;
    exports.discardTelemetryLogEntries = discardTelemetryLogEntries;
    exports.dispatchTelemetryBatch = dispatchTelemetryBatch;
    var MAX_LOG_ENTRIES_PER_EXECUTION = 500;
    var registeredExporters = [];
    var pendingLogEntriesByExecution = new Map();
    var droppedLogEntryCountByExecution = new Map();
    function getNsLog() {
        return require('N/log');
    }
    function registerTelemetryExporter(exporter) {
        var existingIndex = registeredExporters.findIndex(function (candidate) { return candidate.name === exporter.name; });
        if (existingIndex === -1) {
            registeredExporters.push(exporter);
            return;
        }
        registeredExporters[existingIndex] = exporter;
    }
    function unregisterTelemetryExporter(name) {
        var existingIndex = registeredExporters.findIndex(function (candidate) { return candidate.name === name; });
        if (existingIndex !== -1) {
            registeredExporters.splice(existingIndex, 1);
        }
    }
    function clearTelemetryExporters() {
        registeredExporters.length = 0;
    }
    function getTelemetryExporters() {
        return registeredExporters.slice();
    }
    function hasLogAcceptingTelemetryExporter() {
        return registeredExporters.some(function (exporter) { return exporter.acceptsLogEntries; });
    }
    /** Queues a log entry for the run it belongs to; the batch picks it up when the run finishes. */
    function enqueueTelemetryLogEntry(executionId, entry) {
        if (!executionId) {
            return;
        }
        var queue = pendingLogEntriesByExecution.get(executionId);
        if (!queue) {
            pendingLogEntriesByExecution.set(executionId, [entry]);
            return;
        }
        if (queue.length >= MAX_LOG_ENTRIES_PER_EXECUTION) {
            droppedLogEntryCountByExecution.set(executionId, (droppedLogEntryCountByExecution.get(executionId) || 0) + 1);
            return;
        }
        queue.push(entry);
    }
    /** Removes and returns the run's queued log entries, with a closing entry when some were dropped. */
    function takeTelemetryLogEntries(executionId) {
        var queue = pendingLogEntriesByExecution.get(executionId) || [];
        pendingLogEntriesByExecution.delete(executionId);
        var droppedCount = droppedLogEntryCountByExecution.get(executionId) || 0;
        droppedLogEntryCountByExecution.delete(executionId);
        if (droppedCount > 0 && queue.length > 0) {
            var lastEntry = queue[queue.length - 1];
            queue.push(__assign(__assign({}, lastEntry), { level: 'audit', title: 'netsuite-wrapper log entries dropped', details: { droppedCount: droppedCount, keptCount: queue.length, limit: MAX_LOG_ENTRIES_PER_EXECUTION }, functionArguments: undefined }));
        }
        return queue;
    }
    function discardTelemetryLogEntries(executionId) {
        pendingLogEntriesByExecution.delete(executionId);
        droppedLogEntryCountByExecution.delete(executionId);
    }
    /** Hands the batch to every exporter. One exporter failing never stops the others or the script. */
    function dispatchTelemetryBatch(batch) {
        registeredExporters.forEach(function (exporter) {
            try {
                exporter.export(exporter.acceptsLogEntries ? batch : __assign(__assign({}, batch), { logs: [] }));
            }
            catch (error) {
                try {
                    getNsLog().error({
                        title: 'netsuite-wrapper telemetry export failed',
                        details: JSON.stringify({ exporter: exporter.name, message: error instanceof Error ? error.message : String(error) }),
                    });
                }
                catch (_logError) {
                    // Nothing left to report to.
                }
            }
        });
    }
});
