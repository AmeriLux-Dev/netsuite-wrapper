const { setWrapperTelemetrySink } = require('../dist/telemetry.js');

const sinkOptions = typeof __NETSUITE_WRAPPER_AUTO_SCOPE_KEY__ === 'string' && __NETSUITE_WRAPPER_AUTO_SCOPE_KEY__
    ? __NETSUITE_WRAPPER_AUTO_SCOPE_KEY__
    : undefined;
let activeSink = null;

// Registered before the sink exists so the sink never falls back to its own default. Each exporter
// sits behind its own DefinePlugin constant (a boolean, and the httpsExport object or null) so that
// webpack drops the require of an exporter the config never turns on; an unused HTTPS exporter, and
// its N/https dependency, never reach the bundle.
function registerConfiguredExporters() {
    if (__NETSUITE_WRAPPER_AUTO_RECORD_EXPORT__) {
        require('../dist/telemetry-exporter.js').registerTelemetryExporter(
            require('../dist/netsuite-record-exporter.js').createNetSuiteRecordExporter(),
        );
    }
    if (__NETSUITE_WRAPPER_AUTO_HTTPS_EXPORT__) {
        require('../dist/telemetry-exporter.js').registerTelemetryExporter(
            require('../dist/https-exporter.js').createHttpsExporter(__NETSUITE_WRAPPER_AUTO_HTTPS_EXPORT__),
        );
    }
}

// A sink that cannot be created leaves the script untracked instead of retrying on every call:
// each retry would register the exporters again.
const passThroughSink = {
    runOperation(metadata, work) {
        return work();
    },
};

function getOrCreateSink() {
    if (activeSink) {
        return activeSink;
    }

    try {
        registerConfiguredExporters();
        const sinkModule = require(__NETSUITE_WRAPPER_AUTO_SINK_MODULE__);
        const sinkExportName = __NETSUITE_WRAPPER_AUTO_SINK_EXPORT__;
        const createSink = sinkExportName === 'default'
            ? (sinkModule.default || sinkModule)
            : sinkModule[sinkExportName];

        if (typeof createSink !== 'function') {
            throw new Error(`netsuite-wrapper bootstrap could not find sink export "${sinkExportName}" in ${__NETSUITE_WRAPPER_AUTO_SINK_MODULE__}`);
        }

        activeSink = createSink(sinkOptions);
    } catch (error) {
        // Thrown on to runWrappedOperation, which reports it once and runs the call untracked.
        activeSink = passThroughSink;
        throw error;
    }

    return activeSink;
}

setWrapperTelemetrySink({
    runOperation(metadata, work) {
        return getOrCreateSink().runOperation(metadata, work);
    },
});

module.exports = {};