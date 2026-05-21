const { createNetSuiteWrapperRollupPlugin } = require('./rollup');

function createNetSuiteWrapperVitePlugin(options = {}) {
    const rollupPlugin = createNetSuiteWrapperRollupPlugin({
        ...options,
        instrumentation: options.instrumentation && typeof options.instrumentation === 'object'
            ? {
                ...options.instrumentation,
                instrumentationSource: options.instrumentation.instrumentationSource || 'vite-babel-auto',
            }
            : options.instrumentation,
    });

    return {
        ...rollupPlugin,
        name: 'netsuite-wrapper-vite',
        apply: 'build',
        enforce: 'pre',
    };
}

module.exports = {
    createNetSuiteWrapperVitePlugin,
};