const { setWrapperTelemetrySink } = require('./dist/telemetry.js');

const sinkOptions = typeof __NETSUITE_WRAPPER_AUTO_SCOPE_KEY__ === 'string' && __NETSUITE_WRAPPER_AUTO_SCOPE_KEY__
    ? __NETSUITE_WRAPPER_AUTO_SCOPE_KEY__
    : undefined;

let activeSink = null;

function getOrCreateSink() {
    if (activeSink) {
        return activeSink;
    }

    const sinkModule = require(__NETSUITE_WRAPPER_AUTO_SINK_MODULE__);
    const sinkExportName = __NETSUITE_WRAPPER_AUTO_SINK_EXPORT__;
    const createSink = sinkExportName === 'default'
        ? (sinkModule.default || sinkModule)
        : sinkModule[sinkExportName];

    if (typeof createSink !== 'function') {
        throw new Error(`netsuite-wrapper bootstrap could not find sink export "${sinkExportName}" in ${__NETSUITE_WRAPPER_AUTO_SINK_MODULE__}`);
    }

    activeSink = createSink(sinkOptions);
    return activeSink;
}

setWrapperTelemetrySink({
    runOperation(metadata, work) {
        return getOrCreateSink().runOperation(metadata, work);
    },
});

module.exports = {};