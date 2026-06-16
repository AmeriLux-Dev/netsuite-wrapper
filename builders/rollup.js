const path = require('path');
const {
    DEFAULT_OVERRIDE_MODULES,
    DEFAULT_PACKAGE_NAME,
    createOverrideRequestSet,
    createWrapperModuleRequest,
    isWrapperContext,
    loadNetSuiteWrapperConfig,
} = require('../lib/build-support');
const {
    transformNetSuiteWrapperSource,
} = require('../lib/instrumentation-core');

const DEFAULT_INSTRUMENTATION_SOURCE = 'rollup-babel-auto';
const AUTO_BOOTSTRAP_ID = 'virtual:netsuite-wrapper:auto-bootstrap';
const TELEMETRY_MODULE_ID = 'virtual:netsuite-wrapper:telemetry-module';
const SINK_MODULE_ID = 'virtual:netsuite-wrapper:sink-module';
const BOOTSTRAP_MODULE_PREFIX = 'virtual:netsuite-wrapper:bootstrap-module:';
const RESOLVED_AUTO_BOOTSTRAP_ID = '\0netsuite-wrapper:auto-bootstrap';
const TRACE_LOG_BOOTSTRAP_ID = 'virtual:netsuite-wrapper:trace-log-bootstrap';
const RESOLVED_TRACE_LOG_BOOTSTRAP_ID = '\0netsuite-wrapper:trace-log-bootstrap';
const CHUNK_LOG_BOOTSTRAP_ID = 'virtual:netsuite-wrapper:chunk-log-bootstrap';
const RESOLVED_CHUNK_LOG_BOOTSTRAP_ID = '\0netsuite-wrapper:chunk-log-bootstrap';
const LOG_MODULE_ID = 'virtual:netsuite-wrapper:log-module';

function normalizeModuleId(id) {
    return typeof id === 'string' ? id.replace(/[?#].*$/, '') : '';
}

function normalizePathForMatch(value) {
    return normalizeModuleId(value).replace(/\\/g, '/');
}

function normalizeInputEntries(input) {
    if (!input) {
        return [];
    }

    if (typeof input === 'string') {
        return [path.resolve(input)];
    }

    if (Array.isArray(input)) {
        return input.filter((entry) => typeof entry === 'string').map((entry) => path.resolve(entry));
    }

    if (typeof input === 'object') {
        return Object.values(input)
            .filter((entry) => typeof entry === 'string')
            .map((entry) => path.resolve(entry));
    }

    return [];
}

function matchesPattern(pattern, id) {
    if (!pattern) {
        return false;
    }

    if (Array.isArray(pattern)) {
        return pattern.some((candidate) => matchesPattern(candidate, id));
    }

    if (pattern instanceof RegExp) {
        return pattern.test(id);
    }

    if (typeof pattern === 'function') {
        return Boolean(pattern(id));
    }

    if (typeof pattern === 'string') {
        return normalizePathForMatch(id).includes(normalizePathForMatch(pattern));
    }

    return false;
}

function resolveInstrumentationOptions(options = {}) {
    const instrumentationOptions = options.instrumentation;
    if (instrumentationOptions === undefined) {
        return {
            enabled: true,
            instrumentationSource: DEFAULT_INSTRUMENTATION_SOURCE,
        };
    }

    if (instrumentationOptions === true) {
        return {
            enabled: true,
            instrumentationSource: DEFAULT_INSTRUMENTATION_SOURCE,
        };
    }

    if (instrumentationOptions === false) {
        return { enabled: false };
    }

    return {
        enabled: instrumentationOptions.enabled !== false,
        include: instrumentationOptions.include,
        exclude: instrumentationOptions.exclude,
        instrumentationSource: typeof instrumentationOptions.instrumentationSource === 'string' && instrumentationOptions.instrumentationSource
            ? instrumentationOptions.instrumentationSource
            : DEFAULT_INSTRUMENTATION_SOURCE,
    };
}

function shouldInstrument(id, options) {
    if (!options.enabled) {
        return false;
    }

    const normalizedId = normalizeModuleId(id);
    if (!/\.[cm]?[jt]sx?$/i.test(normalizedId)) {
        return false;
    }

    if (matchesPattern(options.exclude, normalizedId) || /node_modules/.test(normalizedId)) {
        return false;
    }

    if (!options.include) {
        return true;
    }

    return matchesPattern(options.include, normalizedId);
}

function createBootstrapImportLines(resolvedOptions) {
    const imports = [];
    if (resolvedOptions.traceLog) {
        imports.push(`import ${JSON.stringify(TRACE_LOG_BOOTSTRAP_ID)};`);
    }

    if (resolvedOptions.chunkLogging !== 'group') {
        imports.push(`import ${JSON.stringify(CHUNK_LOG_BOOTSTRAP_ID)};`);
    }

    if (resolvedOptions.telemetryBootstrap) {
        imports.push(`import ${JSON.stringify(AUTO_BOOTSTRAP_ID)};`);
    }

    (resolvedOptions.bootstrapModules || []).forEach((modulePath, index) => {
        if (modulePath) {
            imports.push(`import ${JSON.stringify(`${BOOTSTRAP_MODULE_PREFIX}${index}`)};`);
        }
    });

    return imports;
}

function prependEntryImports(code, importLines) {
    if (importLines.length === 0) {
        return code;
    }

    const missingImports = importLines.filter((line) => !code.includes(line));
    if (missingImports.length === 0) {
        return code;
    }

    return `${missingImports.join('\n')}\n${code}`;
}

function createTraceLogBootstrapModuleSource() {
    return [
        `import { setTraceLogEnabled } from ${JSON.stringify(LOG_MODULE_ID)};`,
        'setTraceLogEnabled(true);',
        'export {};',
    ].join('\n');
}

function createChunkLogBootstrapModuleSource(chunkLogging) {
    return [
        `import { setChunkLogMode } from ${JSON.stringify(LOG_MODULE_ID)};`,
        `setChunkLogMode(${JSON.stringify(chunkLogging)});`,
        'export {};',
    ].join('\n');
}

function createAutoBootstrapModuleSource(resolvedOptions) {
    if (!resolvedOptions.telemetryBootstrap) {
        return 'export {};';
    }

    return [
        `import { setWrapperTelemetrySink } from ${JSON.stringify(TELEMETRY_MODULE_ID)};`,
        `import * as sinkModule from ${JSON.stringify(SINK_MODULE_ID)};`,
        `const sinkModuleName = ${JSON.stringify(resolvedOptions.telemetryBootstrap.sinkModule)};`,
        `const sinkExportName = ${JSON.stringify(resolvedOptions.telemetryBootstrap.sinkExport)};`,
        `const sinkOptions = ${JSON.stringify(resolvedOptions.telemetryBootstrap.scopeKey)} || undefined;`,
        'let activeSink = null;',
        'function getOrCreateSink() {',
        '    if (activeSink) {',
        '        return activeSink;',
        '    }',
        '    const createSink = sinkExportName === "default" ? (sinkModule.default || sinkModule) : sinkModule[sinkExportName];',
        '    if (typeof createSink !== "function") {',
        '        throw new Error(`netsuite-wrapper bootstrap could not find sink export "${sinkExportName}" in ${sinkModuleName}`);',
        '    }',
        '    activeSink = createSink(sinkOptions);',
        '    return activeSink;',
        '}',
        'setWrapperTelemetrySink({',
        '    runOperation(metadata, work) {',
        '        return getOrCreateSink().runOperation(metadata, work);',
        '    },',
        '});',
        'export {};',
    ].join('\n');
}

function createNetSuiteWrapperRollupPlugin(options = {}) {
    const resolvedOptions = loadNetSuiteWrapperConfig(options);
    const packageName = resolvedOptions.packageName || DEFAULT_PACKAGE_NAME;
    const runtimeDir = resolvedOptions.runtimeDir ? path.resolve(resolvedOptions.runtimeDir) : undefined;
    const overrideModules = resolvedOptions.modules || DEFAULT_OVERRIDE_MODULES;
    const overrideRequests = createOverrideRequestSet(overrideModules);
    const instrumentationOptions = resolveInstrumentationOptions(options);
    const entryIds = new Set();
    const bootstrapImportLines = createBootstrapImportLines(resolvedOptions);

    return {
        name: 'netsuite-wrapper-rollup',
        options(inputOptions) {
            normalizeInputEntries(inputOptions.input).forEach((entryId) => entryIds.add(entryId));
            return null;
        },
        resolveId(source, importer) {
            if (source === AUTO_BOOTSTRAP_ID) {
                return RESOLVED_AUTO_BOOTSTRAP_ID;
            }

            if (source === TRACE_LOG_BOOTSTRAP_ID) {
                return RESOLVED_TRACE_LOG_BOOTSTRAP_ID;
            }

            if (source === CHUNK_LOG_BOOTSTRAP_ID) {
                return RESOLVED_CHUNK_LOG_BOOTSTRAP_ID;
            }

            if (source === TELEMETRY_MODULE_ID) {
                return createWrapperModuleRequest('telemetry', {
                    packageName,
                    runtimeDir,
                });
            }

            if (source === LOG_MODULE_ID) {
                return createWrapperModuleRequest('log', {
                    packageName,
                    runtimeDir,
                });
            }

            if (source === SINK_MODULE_ID) {
                return resolvedOptions.telemetryBootstrap ? resolvedOptions.telemetryBootstrap.sinkModule : null;
            }

            if (source.startsWith(BOOTSTRAP_MODULE_PREFIX)) {
                const bootstrapIndex = Number(source.slice(BOOTSTRAP_MODULE_PREFIX.length));
                return Number.isInteger(bootstrapIndex)
                    ? (resolvedOptions.bootstrapModules || [])[bootstrapIndex] || null
                    : null;
            }

            if (!/^N\//.test(source)) {
                return null;
            }

            if (overrideRequests.has(source) && !isWrapperContext(importer || '', runtimeDir, packageName)) {
                return createWrapperModuleRequest(source.slice(2), {
                    packageName,
                    runtimeDir,
                });
            }

            return {
                id: source,
                external: true,
            };
        },
        load(id) {
            if (id === RESOLVED_TRACE_LOG_BOOTSTRAP_ID) {
                return createTraceLogBootstrapModuleSource();
            }

            if (id === RESOLVED_CHUNK_LOG_BOOTSTRAP_ID) {
                return createChunkLogBootstrapModuleSource(resolvedOptions.chunkLogging);
            }

            if (id === RESOLVED_AUTO_BOOTSTRAP_ID) {
                return createAutoBootstrapModuleSource(resolvedOptions);
            }

            return null;
        },
        transform(code, id) {
            const normalizedId = normalizeModuleId(id);
            const resolvedId = path.isAbsolute(normalizedId) ? path.resolve(normalizedId) : normalizedId;
            const withEntryImports = entryIds.has(resolvedId)
                ? prependEntryImports(code, bootstrapImportLines)
                : code;

            if (!shouldInstrument(normalizedId, instrumentationOptions)) {
                return withEntryImports === code
                    ? null
                    : { code: withEntryImports, map: null };
            }

            const transformed = transformNetSuiteWrapperSource(withEntryImports, {
                resourcePath: normalizedId,
                rootContext: options.rootContext || process.cwd(),
                packageName,
                instrumentationSource: instrumentationOptions.instrumentationSource,
            });

            if (!transformed) {
                return withEntryImports === code
                    ? null
                    : { code: withEntryImports, map: null };
            }

            return {
                code: transformed.code,
                map: transformed.map || null,
            };
        },
    };
}

module.exports = {
    createNetSuiteWrapperRollupPlugin,
};