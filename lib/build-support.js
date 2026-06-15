const fs = require('fs');
const path = require('path');
const { listOverrideModules } = require('./override-modules');
const PACKAGE_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PACKAGE_NAME = '@amerilux/netsuite-wrapper';
const DEFAULT_CONFIG_FILE = 'netsuite-wrapper.config.js';
const DEFAULT_OVERRIDE_MODULES = listOverrideModules(PACKAGE_ROOT);
const DEFAULT_TELEMETRY_BOOTSTRAP = Object.freeze({
    integration: 'performance-tracker',
});

function unwrapConfigModule(configModule) {
    if (configModule && typeof configModule === 'object' && 'default' in configModule) {
        return configModule.default;
    }

    return configModule;
}

function resolveConfigFilePath(configPath) {
    const candidatePath = configPath
        ? path.resolve(process.cwd(), configPath)
        : path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);

    return fs.existsSync(candidatePath) ? candidatePath : '';
}

function resolveModuleListFromConfig(configDir, modulePaths) {
    if (!Array.isArray(modulePaths)) {
        return [];
    }

    return modulePaths
        .filter(Boolean)
        .map((modulePath) => path.resolve(configDir, modulePath));
}

function resolveTelemetryBootstrap(configDir, telemetryBootstrap, packageName = DEFAULT_PACKAGE_NAME) {
    if (telemetryBootstrap === false || telemetryBootstrap === null) {
        return null;
    }

    const normalizedTelemetryBootstrap = telemetryBootstrap === undefined
        ? DEFAULT_TELEMETRY_BOOTSTRAP
        : telemetryBootstrap;

    if (!normalizedTelemetryBootstrap || typeof normalizedTelemetryBootstrap !== 'object') {
        return null;
    }

    if (normalizedTelemetryBootstrap.integration === 'performance-tracker') {
        return {
            sinkModule: `${packageName}/performance-tracker`,
            sinkExport: 'createPerformanceTrackerSink',
            scopeKey: '',
        };
    }

    const sinkModule = typeof normalizedTelemetryBootstrap.sinkModule === 'string'
        ? path.resolve(configDir, normalizedTelemetryBootstrap.sinkModule)
        : '';
    const sinkExport = typeof normalizedTelemetryBootstrap.sinkExport === 'string' && normalizedTelemetryBootstrap.sinkExport
        ? normalizedTelemetryBootstrap.sinkExport
        : 'default';
    const scopeKey = typeof normalizedTelemetryBootstrap.scopeKey === 'string'
        ? normalizedTelemetryBootstrap.scopeKey
        : '';

    if (!sinkModule) {
        return null;
    }

    return {
        sinkModule,
        sinkExport,
        scopeKey,
    };
}

function resolveTraceLog(value) {
    return value === true;
}

function loadNetSuiteWrapperConfig(options = {}) {
    const configFilePath = resolveConfigFilePath(options.configPath);
    if (!configFilePath) {
        const packageName = options.packageName;

        return {
            packageName,
            runtimeDir: options.runtimeDir,
            modules: options.modules,
            bootstrapModules: options.bootstrapModules,
            telemetryBootstrap: resolveTelemetryBootstrap(process.cwd(), options.telemetryBootstrap, packageName),
            traceLog: resolveTraceLog(options.traceLog),
        };
    }

    const configDir = path.dirname(configFilePath);
    const config = unwrapConfigModule(require(configFilePath)) || {};
    const packageName = options.packageName || config.packageName;

    return {
        packageName,
        runtimeDir: options.runtimeDir || (config.runtimeDir ? path.resolve(configDir, config.runtimeDir) : undefined),
        modules: options.modules || config.modules,
        bootstrapModules: options.bootstrapModules || resolveModuleListFromConfig(configDir, config.bootstrapModules),
        telemetryBootstrap: options.telemetryBootstrap !== undefined
            ? resolveTelemetryBootstrap(configDir, options.telemetryBootstrap, packageName)
            : resolveTelemetryBootstrap(configDir, config.telemetryBootstrap, packageName),
        traceLog: options.traceLog !== undefined
            ? resolveTraceLog(options.traceLog)
            : resolveTraceLog(config.traceLog),
    };
}

function normalizeSlashes(value) {
    return value.replace(/\\/g, '/');
}

function isWrapperContext(contextPath, runtimeDir, packageName) {
    if (!contextPath) {
        return false;
    }

    const normalizedContext = normalizeSlashes(contextPath);
    const normalizedRuntimeDir = runtimeDir ? normalizeSlashes(runtimeDir) : '';
    const normalizedPackageName = packageName ? normalizeSlashes(packageName) : '';

    return Boolean(normalizedRuntimeDir && normalizedContext.startsWith(normalizedRuntimeDir)) ||
        normalizedContext.includes('/netsuite-wrapper/') ||
        Boolean(normalizedPackageName && normalizedContext.includes(`/${normalizedPackageName}/`));
}

function createWrapperModuleRequest(moduleName, options = {}) {
    if (options.runtimeDir) {
        return path.join(options.runtimeDir, `${moduleName}.js`);
    }

    return `${options.packageName || DEFAULT_PACKAGE_NAME}/${moduleName}`;
}

function createOverrideRequestSet(overrideModules) {
    return new Set(overrideModules.map((moduleName) => `N/${moduleName}`));
}

function prependUniqueModules(entryValue, bootstrapModules) {
    const normalizedEntry = Array.isArray(entryValue) ? entryValue.slice() : [entryValue];
    const seen = new Set(normalizedEntry);
    const prepended = [];

    for (const modulePath of bootstrapModules) {
        if (!seen.has(modulePath)) {
            prepended.push(modulePath);
            seen.add(modulePath);
        }
    }

    return prepended.concat(normalizedEntry);
}

module.exports = {
    DEFAULT_CONFIG_FILE,
    DEFAULT_OVERRIDE_MODULES,
    DEFAULT_PACKAGE_NAME,
    DEFAULT_TELEMETRY_BOOTSTRAP,
    createOverrideRequestSet,
    createWrapperModuleRequest,
    isWrapperContext,
    loadNetSuiteWrapperConfig,
    normalizeSlashes,
    prependUniqueModules,
    resolveConfigFilePath,
    resolveTelemetryBootstrap,
};