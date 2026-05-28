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
    function resolveWrapperOperationMetadata(metadata) {
        return typeof metadata === 'function'
            ? metadata()
            : metadata;
    }
    function runWrappedOperation(metadata, work) {
        if (!activeSink || (typeof activeSink.isActive === 'function' && !activeSink.isActive())) {
            return work();
        }
        return activeSink.runOperation(resolveWrapperOperationMetadata(metadata), work);
    }
});
