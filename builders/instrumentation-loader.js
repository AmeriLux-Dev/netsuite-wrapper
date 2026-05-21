const {
    DEFAULT_INSTRUMENTATION_SOURCE,
    transformNetSuiteWrapperSource,
} = require('../internal/instrumentation-core');

module.exports = function instrumentationLoader(source, inputSourceMap) {
    if (typeof this.cacheable === 'function') {
        this.cacheable();
    }

    const options = typeof this.getOptions === 'function' ? this.getOptions() || {} : {};
    const result = transformNetSuiteWrapperSource(source, {
        resourcePath: this.resourcePath || '',
        rootContext: options.rootContext || this.rootContext || process.cwd(),
        functionContextModule: options.functionContextModule,
        trackedScriptEntryModule: options.trackedScriptEntryModule,
        instrumentationSource: options.instrumentationSource || DEFAULT_INSTRUMENTATION_SOURCE,
        sourceMap: Boolean(this.sourceMap),
        inputSourceMap,
    });

    if (!result) {
        return this.callback(null, source, inputSourceMap);
    }

    return this.callback(null, result.code, result.map || inputSourceMap);
};