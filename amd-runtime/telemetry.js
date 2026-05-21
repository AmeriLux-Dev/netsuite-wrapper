define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getWrapperTelemetrySink = getWrapperTelemetrySink;
    exports.setWrapperTelemetrySink = setWrapperTelemetrySink;
    exports.withWrapperTelemetrySink = withWrapperTelemetrySink;
    exports.runWrappedOperation = runWrappedOperation;
    var activeSink = null;
    function getWrapperTelemetrySink() {
        return activeSink;
    }
    function setWrapperTelemetrySink(sink) {
        activeSink = sink;
    }
    function withWrapperTelemetrySink(sink, work) {
        var previousSink = activeSink;
        activeSink = sink;
        try {
            return work();
        }
        finally {
            activeSink = previousSink;
        }
    }
    function runWrappedOperation(metadata, work) {
        if (!activeSink) {
            return work();
        }
        return activeSink.runOperation(metadata, work);
    }
});
