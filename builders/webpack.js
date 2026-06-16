const path = require('path');
const {
    DEFAULT_OVERRIDE_MODULES,
    DEFAULT_PACKAGE_NAME,
    createOverrideRequestSet,
    createWrapperModuleRequest,
    isWrapperContext,
    loadNetSuiteWrapperConfig,
    prependUniqueModules,
} = require('../lib/build-support');

const DEFAULT_INSTRUMENTATION_SOURCE = 'webpack-babel-auto';
const FUNCTION_CONTEXT_MODULE_PATH = path.join(__dirname, '..', 'dist', 'function-context.js');
const TRACKED_SCRIPT_ENTRY_MODULE_PATH = path.join(__dirname, '..', 'dist', 'performance-tracker.js');

function loadWebpack() {
    return require(require.resolve('webpack', {
        paths: [process.cwd(), __dirname],
    }));
}

const INTERNAL_BOOTSTRAP_MODULE = path.join(__dirname, '..', 'lib', 'webpack-bootstrap.js');
const INTERNAL_TRACE_LOG_BOOTSTRAP_MODULE = path.join(__dirname, '..', 'lib', 'trace-log-bootstrap.js');
const INTERNAL_CHUNK_LOG_BOOTSTRAP_MODULES = {
    silent: path.join(__dirname, '..', 'lib', 'chunk-log-bootstrap-silent.js'),
    off: path.join(__dirname, '..', 'lib', 'chunk-log-bootstrap-off.js'),
};

function normalizeRules(rules) {
    if (!rules) {
        return [];
    }

    return Array.isArray(rules) ? rules.slice() : [rules];
}

function resolveInstrumentationOptions(options = {}) {
    const instrumentationOptions = options.instrumentation;

    if (instrumentationOptions === false) {
        return { enabled: false };
    }

    const normalizedOptions = instrumentationOptions && typeof instrumentationOptions === 'object'
        ? instrumentationOptions
        : {};

    return {
        enabled: normalizedOptions.enabled !== false,
        include: normalizedOptions.include,
        exclude: normalizedOptions.exclude,
        instrumentationSource: typeof normalizedOptions.instrumentationSource === 'string' && normalizedOptions.instrumentationSource
            ? normalizedOptions.instrumentationSource
            : DEFAULT_INSTRUMENTATION_SOURCE,
    };
}

function createNetSuiteWrapperInstrumentationRule(options = {}, config = {}) {
    const instrumentationOptions = resolveInstrumentationOptions(options);
    if (!instrumentationOptions.enabled) {
        return null;
    }

    return {
        test: /\.[cm]?[jt]sx?$/i,
        enforce: 'pre',
        include: instrumentationOptions.include || config.context,
        exclude: instrumentationOptions.exclude || [/node_modules/, /\.d\.ts$/i],
        use: [{
            loader: path.join(__dirname, 'instrumentation-loader.js'),
            options: {
                functionContextModule: FUNCTION_CONTEXT_MODULE_PATH,
                trackedScriptEntryModule: TRACKED_SCRIPT_ENTRY_MODULE_PATH,
                instrumentationSource: instrumentationOptions.instrumentationSource,
            },
        }],
    };
}

function createNetSuiteWrapperWebpackEntries(entries, options = {}) {
    const resolvedOptions = loadNetSuiteWrapperConfig(options);
    const bootstrapModules = [];

    if (resolvedOptions.traceLog) {
        bootstrapModules.push(INTERNAL_TRACE_LOG_BOOTSTRAP_MODULE);
    }

    const chunkLogBootstrapModule = INTERNAL_CHUNK_LOG_BOOTSTRAP_MODULES[resolvedOptions.chunkLogging];
    if (chunkLogBootstrapModule) {
        bootstrapModules.push(chunkLogBootstrapModule);
    }

    if (resolvedOptions.telemetryBootstrap) {
        bootstrapModules.push(INTERNAL_BOOTSTRAP_MODULE);
    }

    bootstrapModules.push(...(resolvedOptions.bootstrapModules || []).filter(Boolean));

    if (bootstrapModules.length === 0) {
        return entries;
    }

    return normalizeWebpackEntry(entries, bootstrapModules);
}

function isWebpackEntryDescriptor(entryValue) {
    if (!entryValue || typeof entryValue !== 'object' || Array.isArray(entryValue)) {
        return false;
    }

    return Object.prototype.hasOwnProperty.call(entryValue, 'import');
}

function rewriteWebpackEntryValue(entryValue, bootstrapModules) {
    if (typeof entryValue === 'string' || Array.isArray(entryValue)) {
        return prependUniqueModules(entryValue, bootstrapModules);
    }

    if (isWebpackEntryDescriptor(entryValue)) {
        return {
            ...entryValue,
            import: prependUniqueModules(entryValue.import || [], bootstrapModules),
        };
    }

    if (!entryValue || typeof entryValue !== 'object') {
        return entryValue;
    }

    return Object.fromEntries(Object.entries(entryValue).map(([entryName, nestedEntryValue]) => [
        entryName,
        rewriteWebpackEntryValue(nestedEntryValue, bootstrapModules),
    ]));
}

function normalizeWebpackEntry(entries, bootstrapModules) {
    if (typeof entries === 'function') {
        return async (...args) => rewriteWebpackEntryValue(await entries(...args), bootstrapModules);
    }

    return rewriteWebpackEntryValue(entries, bootstrapModules);
}

function createNetSuiteWrapperWebpackPlugins(options = {}) {
    const webpack = loadWebpack();
    const resolvedOptions = loadNetSuiteWrapperConfig(options);
    const packageName = resolvedOptions.packageName || DEFAULT_PACKAGE_NAME;
    const runtimeDir = resolvedOptions.runtimeDir ? path.resolve(resolvedOptions.runtimeDir) : undefined;
    const overrideModules = resolvedOptions.modules || DEFAULT_OVERRIDE_MODULES;
    const plugins = overrideModules.map((moduleName) => {
        const matcher = new RegExp(`^N/${moduleName}$`);

        return new webpack.NormalModuleReplacementPlugin(matcher, (resource) => {
            if (isWrapperContext(resource.context, runtimeDir, packageName)) {
                return;
            }

            resource.request = createWrapperModuleRequest(moduleName, {
                packageName,
                runtimeDir,
            });
        });
    });

    if (resolvedOptions.telemetryBootstrap) {
        plugins.push(new webpack.DefinePlugin({
            __NETSUITE_WRAPPER_AUTO_SINK_MODULE__: JSON.stringify(resolvedOptions.telemetryBootstrap.sinkModule),
            __NETSUITE_WRAPPER_AUTO_SINK_EXPORT__: JSON.stringify(resolvedOptions.telemetryBootstrap.sinkExport),
            __NETSUITE_WRAPPER_AUTO_SCOPE_KEY__: JSON.stringify(resolvedOptions.telemetryBootstrap.scopeKey),
        }));
    }

    return plugins;
}

function createNetSuiteWrapperWebpackExternals(options = {}) {
    const resolvedOptions = loadNetSuiteWrapperConfig(options);
    const packageName = resolvedOptions.packageName || DEFAULT_PACKAGE_NAME;
    const runtimeDir = resolvedOptions.runtimeDir ? path.resolve(resolvedOptions.runtimeDir) : undefined;
    const overrideModules = resolvedOptions.modules || DEFAULT_OVERRIDE_MODULES;
    const overrideRequests = createOverrideRequestSet(overrideModules);

    return function netsuiteWrapperExternals({ context, request }, callback) {
        if (!/^N\//.test(request)) {
            return callback();
        }

        if (overrideRequests.has(request) && !isWrapperContext(context, runtimeDir, packageName)) {
            return callback();
        }

        return callback(null, 'amd ' + request);
    };
}

function normalizeExternals(externals) {
    if (!externals) {
        return [];
    }

    return Array.isArray(externals) ? externals.slice() : [externals];
}

function normalizePlugins(plugins) {
    if (!plugins) {
        return [];
    }

    return Array.isArray(plugins) ? plugins.slice() : [plugins];
}

function applyNetSuiteWrapperWebpack(config, options = {}) {
    const instrumentationRule = createNetSuiteWrapperInstrumentationRule(options, config);

    return {
        ...config,
        entry: createNetSuiteWrapperWebpackEntries(config.entry || {}, options),
        plugins: [
            ...createNetSuiteWrapperWebpackPlugins(options),
            ...normalizePlugins(config.plugins),
        ],
        module: instrumentationRule ? {
            ...(config.module || {}),
            rules: [
                instrumentationRule,
                ...normalizeRules(config.module && config.module.rules),
            ],
        } : config.module,
        externals: [
            createNetSuiteWrapperWebpackExternals(options),
            ...normalizeExternals(config.externals),
        ],
    };
}

module.exports = {
    DEFAULT_OVERRIDE_MODULES,
    applyNetSuiteWrapperWebpack,
    createNetSuiteWrapperInstrumentationRule,
    createNetSuiteWrapperWebpackEntries,
    createNetSuiteWrapperWebpackExternals,
    createNetSuiteWrapperWebpackPlugins,
};