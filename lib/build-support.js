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

function normalizeConfigString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

// The optional remote destination. Everything here is baked into the bundle at build time, so it
// holds the endpoint and the *name* of the API secret, never a token. `format` is a function and
// cannot cross the build boundary; a project needing a custom payload registers its own exporter
// from a bootstrap module instead.
function resolveHttpsExport(httpsExport) {
    if (!httpsExport || typeof httpsExport !== 'object') {
        return null;
    }

    const url = normalizeConfigString(httpsExport.url);
    if (!url) {
        return null;
    }

    const headers = httpsExport.headers && typeof httpsExport.headers === 'object'
        ? Object.fromEntries(Object.entries(httpsExport.headers).filter(([, value]) => typeof value === 'string'))
        : undefined;

    return {
        url,
        ...(normalizeConfigString(httpsExport.secretId) ? { secretId: normalizeConfigString(httpsExport.secretId) } : {}),
        ...(typeof httpsExport.authorizationHeader === 'string' ? { authorizationHeader: httpsExport.authorizationHeader } : {}),
        ...(typeof httpsExport.authorizationScheme === 'string' ? { authorizationScheme: httpsExport.authorizationScheme } : {}),
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
        ...(normalizeConfigString(httpsExport.source) ? { source: normalizeConfigString(httpsExport.source) } : {}),
    };
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

    const scopeKey = normalizeConfigString(normalizedTelemetryBootstrap.scopeKey);
    const exporterSettings = {
        recordExport: normalizedTelemetryBootstrap.recordExport !== false,
        httpsExport: resolveHttpsExport(normalizedTelemetryBootstrap.httpsExport),
    };

    if (normalizedTelemetryBootstrap.integration === 'performance-tracker') {
        return {
            sinkModule: `${packageName}/performance-tracker`,
            sinkExport: 'createPerformanceTrackerSink',
            scopeKey,
            ...exporterSettings,
        };
    }

    const sinkModule = typeof normalizedTelemetryBootstrap.sinkModule === 'string'
        ? path.resolve(configDir, normalizedTelemetryBootstrap.sinkModule)
        : '';
    const sinkExport = typeof normalizedTelemetryBootstrap.sinkExport === 'string' && normalizedTelemetryBootstrap.sinkExport
        ? normalizedTelemetryBootstrap.sinkExport
        : 'default';

    if (!sinkModule) {
        return null;
    }

    return {
        sinkModule,
        sinkExport,
        scopeKey,
        ...exporterSettings,
    };
}

/** The scope key every @NScriptType entry file is tracked under when its header names none. */
function resolveDefaultScopeKey(options = {}) {
    const instrumentationOptions = options.instrumentation && typeof options.instrumentation === 'object'
        ? options.instrumentation
        : {};
    if (normalizeConfigString(instrumentationOptions.defaultScopeKey)) {
        return normalizeConfigString(instrumentationOptions.defaultScopeKey);
    }

    const resolvedOptions = loadNetSuiteWrapperConfig(options);
    return resolvedOptions.telemetryBootstrap ? resolvedOptions.telemetryBootstrap.scopeKey || '' : '';
}

/** What the generated bootstrap needs to register exporters: `{ recordExport, httpsExport }` or null. */
function resolveExporterSettings(telemetryBootstrap) {
    if (!telemetryBootstrap) {
        return null;
    }

    return {
        recordExport: telemetryBootstrap.recordExport !== false,
        httpsExport: telemetryBootstrap.httpsExport || null,
    };
}

function resolveTraceLog(value) {
    return value === true;
}

function resolveChunkLogging(value) {
    return value === 'silent' || value === 'off' ? value : 'group';
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
            chunkLogging: resolveChunkLogging(options.chunkLogging),
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
        chunkLogging: options.chunkLogging !== undefined
            ? resolveChunkLogging(options.chunkLogging)
            : resolveChunkLogging(config.chunkLogging),
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
    resolveDefaultScopeKey,
    resolveExporterSettings,
    resolveHttpsExport,
    resolveTelemetryBootstrap,
};