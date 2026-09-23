define(["require", "exports", "./fail-open"], function (require, exports, fail_open_1) {
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
        var sink = activeSink;
        if (!sink) {
            return work();
        }
        // Everything the sink does, including deciding whether it is active and building the metadata,
        // runs inside observe(): a sink that fails never stops the N/* call or changes what it returns.
        return (0, fail_open_1.observe)(work, function (observedWork) {
            if (typeof sink.isActive === 'function' && !sink.isActive()) {
                return observedWork();
            }
            return sink.runOperation(resolveWrapperOperationMetadata(metadata), observedWork);
        });
    }
});
