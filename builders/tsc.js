const fs = require('fs');
const path = require('path');
const {
    DEFAULT_PACKAGE_NAME,
    loadNetSuiteWrapperConfig,
} = require('../lib/build-support');
const { transformNetSuiteWrapperSource } = require('../lib/instrumentation-core');
const { listOverrideSpecifiers } = require('../lib/override-modules');

const DEFAULT_RUNTIME_DIR = path.join(__dirname, '..', 'amd-runtime');
const DEFAULT_WRAPPER_SUBDIR = 'netsuite-wrapper';
const AUTO_BOOTSTRAP_FILE_NAME = 'bootstrap.js';
const TRACE_LOG_BOOTSTRAP_FILE_NAME = 'trace-log-bootstrap.js';
const CHUNK_LOG_BOOTSTRAP_FILE_NAME = 'chunk-log-bootstrap.js';
const DEFAULT_INSTRUMENTATION_SOURCE = 'tsc-amd-auto';
const overrideModules = new Set(listOverrideSpecifiers(path.resolve(__dirname, '..')));

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeSlashes(filePath) {
    return filePath.replace(/\\/g, '/');
}

function getAllFiles(rootDir, options = {}) {
    const results = [];

    if (!fs.existsSync(rootDir)) {
        return results;
    }

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (typeof options.shouldSkipDir === 'function' && options.shouldSkipDir(fullPath)) {
                continue;
            }

            results.push(...getAllFiles(fullPath, options));
        } else {
            results.push(fullPath);
        }
    }

    return results;
}

function shouldCopyFile(sourceFile, targetFile) {
    if (!fs.existsSync(targetFile)) {
        return true;
    }

    const sourceStat = fs.statSync(sourceFile);
    const targetStat = fs.statSync(targetFile);
    if (sourceStat.size !== targetStat.size) {
        return true;
    }

    return !fs.readFileSync(sourceFile).equals(fs.readFileSync(targetFile));
}

function copyDirectoryContents(sourceDir, targetDir) {
    for (const sourceFile of getAllFiles(sourceDir)) {
        const relativePath = path.relative(sourceDir, sourceFile);
        const targetFile = path.join(targetDir, relativePath);
        ensureDirectory(path.dirname(targetFile));

        if (shouldCopyFile(sourceFile, targetFile)) {
            fs.copyFileSync(sourceFile, targetFile);
        }
    }
}

function collectWrapperModules(runtimeDir) {
    const moduleMap = new Map();

    for (const filePath of getAllFiles(runtimeDir)) {
        if (!filePath.endsWith('.js')) {
            continue;
        }

        const relativePath = normalizeSlashes(path.relative(runtimeDir, filePath));
        const modulePath = relativePath.slice(0, -'.js'.length);
        const specifier = `N/${modulePath}`;
        if (overrideModules.has(specifier)) {
            moduleMap.set(specifier, filePath);
        }
    }

    return moduleMap;
}

function toModuleId(fromFile, targetFile) {
    const fromDir = path.dirname(fromFile);
    let relativePath = normalizeSlashes(path.relative(fromDir, targetFile));
    relativePath = relativePath.slice(0, -'.js'.length);

    if (!relativePath.startsWith('.')) {
        relativePath = `./${relativePath}`;
    }

    return relativePath;
}

function rewriteDefineDependencies(sourceText, resolveSpecifier) {
    return sourceText.replace(/define\(\s*\[(.*?)\](\s*,\s*function)/s, (fullMatch, dependenciesText, suffix) => {
        const rewrittenDependencies = dependenciesText.replace(/(['"])(N\/[^'"]+)\1/g, (match, quote, specifier) => {
            return `${quote}${resolveSpecifier(specifier)}${quote}`;
        });

        return `define([${rewrittenDependencies}]${suffix}`;
    });
}

function rewriteRequireCalls(sourceText, resolveSpecifier) {
    return sourceText.replace(/require\((['"])(N\/[^'"]+)\1\)/g, (match, quote, specifier) => {
        return `require(${quote}${resolveSpecifier(specifier)}${quote})`;
    });
}

function prependAmdDependencies(sourceText, dependencies) {
    if (dependencies.length === 0) {
        return sourceText;
    }

    return sourceText.replace(/define\(\s*\[(.*?)\](\s*,\s*function)/s, (fullMatch, dependenciesText, suffix) => {
        const existingDependencies = new Set(
            Array.from(dependenciesText.matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]),
        );
        const missingDependencies = dependencies.filter((dependency) => !existingDependencies.has(dependency));
        if (missingDependencies.length === 0) {
            return fullMatch;
        }

        const prefix = dependenciesText.trim() ? `${missingDependencies.map((dependency) => JSON.stringify(dependency)).join(', ')}, ` : `${missingDependencies.map((dependency) => JSON.stringify(dependency)).join(', ')}`;
        return `define([${prefix}${dependenciesText}]${suffix}`;
    });
}

function mapSourceModuleToOutputFile(modulePath, outDir, rootDir) {
    const resolvedModulePath = path.resolve(modulePath);
    if (fs.existsSync(resolvedModulePath) && resolvedModulePath.startsWith(path.resolve(outDir))) {
        return resolvedModulePath;
    }

    if (!rootDir) {
        return '';
    }

    const resolvedRootDir = path.resolve(rootDir);
    const normalizedRootDir = normalizeSlashes(resolvedRootDir);
    const normalizedModulePath = normalizeSlashes(resolvedModulePath);
    if (normalizedModulePath !== normalizedRootDir && !normalizedModulePath.startsWith(`${normalizedRootDir}/`)) {
        return '';
    }

    const relativeSourcePath = path.relative(resolvedRootDir, resolvedModulePath);
    const outputFile = path.join(outDir, relativeSourcePath).replace(/\.[^.]+$/, '.js');
    return fs.existsSync(outputFile) ? outputFile : '';
}

function createAmdBootstrapSource(sinkModuleId, sinkExportName, scopeKey) {
    return [
        `define([${JSON.stringify('./telemetry')}, ${JSON.stringify(sinkModuleId)}], function (telemetryModule, sinkModule) {`,
        `    var sinkModuleName = ${JSON.stringify(sinkModuleId)};`,
        `    var sinkExport = ${JSON.stringify(sinkExportName)};`,
        `    var sinkOptions = ${JSON.stringify(scopeKey || '')} || undefined;`,
        '    var activeSink = null;',
        '    function getOrCreateSink() {',
        '        if (activeSink) {',
        '            return activeSink;',
        '        }',
        '        var createSink = sinkExport === "default" ? (sinkModule.default || sinkModule) : sinkModule[sinkExport];',
        '        if (typeof createSink !== "function") {',
        '            throw new Error("netsuite-wrapper bootstrap could not find sink export \"" + sinkExport + "\" in " + sinkModuleName);',
        '        }',
        '        activeSink = createSink(sinkOptions);',
        '        return activeSink;',
        '    }',
        '    telemetryModule.setWrapperTelemetrySink({',
        '        runOperation: function (metadata, work) {',
        '            return getOrCreateSink().runOperation(metadata, work);',
        '        }',
        '    });',
        '});',
    ].join('\n');
}

function createAmdTraceLogBootstrapSource() {
    return [
        `define([${JSON.stringify('./log')}], function (logModule) {`,
        '    logModule.setTraceLogEnabled(true);',
        '});',
    ].join('\n');
}

function createAmdChunkLogBootstrapSource(chunkLogging) {
    return [
        `define([${JSON.stringify('./log')}], function (logModule) {`,
        `    logModule.setChunkLogMode(${JSON.stringify(chunkLogging)});`,
        '});',
    ].join('\n');
}

function resolveBootstrapFiles(resolvedOptions, outDir, wrapperOutputDir, rootDir) {
    const bootstrapFiles = [];
    const defaultPerformanceTrackerModule = `${resolvedOptions.packageName || DEFAULT_PACKAGE_NAME}/performance-tracker`;

    if (resolvedOptions.traceLog) {
        const traceBootstrapFile = path.join(wrapperOutputDir, TRACE_LOG_BOOTSTRAP_FILE_NAME);
        fs.writeFileSync(traceBootstrapFile, createAmdTraceLogBootstrapSource(), 'utf8');
        bootstrapFiles.push(traceBootstrapFile);
    }

    if (resolvedOptions.chunkLogging !== 'group') {
        const chunkBootstrapFile = path.join(wrapperOutputDir, CHUNK_LOG_BOOTSTRAP_FILE_NAME);
        fs.writeFileSync(chunkBootstrapFile, createAmdChunkLogBootstrapSource(resolvedOptions.chunkLogging), 'utf8');
        bootstrapFiles.push(chunkBootstrapFile);
    }

    if (resolvedOptions.telemetryBootstrap) {
        const bootstrapFile = path.join(wrapperOutputDir, AUTO_BOOTSTRAP_FILE_NAME);
        let sinkModuleId = './performance-tracker';

        if (resolvedOptions.telemetryBootstrap.sinkModule !== defaultPerformanceTrackerModule) {
            const emittedSinkFile = mapSourceModuleToOutputFile(resolvedOptions.telemetryBootstrap.sinkModule, outDir, rootDir);
            if (!emittedSinkFile) {
                throw new Error(
                    'Unable to map telemetryBootstrap.sinkModule into the tsc output. Provide a rootDir that matches the emitted build or disable telemetryBootstrap for the plain tsc integration.'
                );
            }

            sinkModuleId = toModuleId(bootstrapFile, emittedSinkFile);
        }

        fs.writeFileSync(bootstrapFile, createAmdBootstrapSource(
            sinkModuleId,
            resolvedOptions.telemetryBootstrap.sinkExport,
            resolvedOptions.telemetryBootstrap.scopeKey,
        ), 'utf8');
        bootstrapFiles.push(bootstrapFile);
    }

    for (const modulePath of resolvedOptions.bootstrapModules || []) {
        const emittedBootstrapFile = mapSourceModuleToOutputFile(modulePath, outDir, rootDir);
        if (!emittedBootstrapFile) {
            throw new Error(
                `Unable to map bootstrap module into the tsc output: ${modulePath}. Provide a rootDir that matches the emitted build.`
            );
        }

        bootstrapFiles.push(emittedBootstrapFile);
    }

    return bootstrapFiles;
}

function resolveTscInstrumentationOptions(options = {}) {
    if (options.instrumentation === false) {
        return { enabled: false };
    }

    if (options.instrumentation && typeof options.instrumentation === 'object') {
        return {
            enabled: options.instrumentation.enabled !== false,
            instrumentationSource: typeof options.instrumentation.instrumentationSource === 'string' && options.instrumentation.instrumentationSource
                ? options.instrumentation.instrumentationSource
                : DEFAULT_INSTRUMENTATION_SOURCE,
        };
    }

    return {
        enabled: true,
        instrumentationSource: DEFAULT_INSTRUMENTATION_SOURCE,
    };
}

function rewriteNetSuiteWrapperTscOutput(options = {}) {
    const outDir = options.outDir ? path.resolve(process.cwd(), options.outDir) : '';
    if (!outDir) {
        throw new Error('Missing required option: outDir');
    }

    const runtimeDir = options.runtimeDir
        ? path.resolve(process.cwd(), options.runtimeDir)
        : DEFAULT_RUNTIME_DIR;
    const wrapperSubdir = options.wrapperSubdir || DEFAULT_WRAPPER_SUBDIR;
    const wrapperOutputDir = path.join(outDir, wrapperSubdir);
    const rootDir = options.rootDir ? path.resolve(process.cwd(), options.rootDir) : undefined;
    const resolvedOptions = loadNetSuiteWrapperConfig(options);

    if (!fs.existsSync(outDir)) {
        throw new Error(`Output directory does not exist: ${outDir}`);
    }

    if (!fs.existsSync(runtimeDir)) {
        throw new Error(`AMD runtime directory does not exist: ${runtimeDir}. Run \"npm run build:amd-runtime\" first.`);
    }

    ensureDirectory(wrapperOutputDir);
    copyDirectoryContents(runtimeDir, wrapperOutputDir);

    const bootstrapFiles = resolveBootstrapFiles(resolvedOptions, outDir, wrapperOutputDir, rootDir);
    const instrumentationOptions = resolveTscInstrumentationOptions(options);
    const wrapperModules = collectWrapperModules(wrapperOutputDir);
    const functionContextModuleFile = instrumentationOptions.enabled
        ? path.join(wrapperOutputDir, 'function-context.js')
        : '';
    const trackedScriptEntryModuleFile = instrumentationOptions.enabled
        ? path.join(wrapperOutputDir, 'performance-tracker.js')
        : '';
    const normalizedWrapperOutputDir = normalizeSlashes(wrapperOutputDir);
    const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts'];
    let filteredOutputFiles;
    if (rootDir) {
        // Scope instrumentation to the files tsc actually emitted from sources under rootDir, then
        // narrow further to the modules reachable from "root" scripts (those carrying a @pftr:scopeKey
        // marker). A single configured script therefore instruments only itself and the modules it
        // imports transitively, and leaves every unrelated emitted module untouched. Vendored,
        // non-AMD files outside the emitted set are never visited, so they cannot abort the rewrite.
        const resolvedRootDir = path.resolve(rootDir);
        const emittedOutputFiles = [];
        const rootOutputFiles = [];

        const hasScopeKeyMarker = (sourceCode) => {
            const leadingCommentMatch = sourceCode.match(/^\s*((?:\/\*[\s\S]*?\*\/\s*|\/\/[^\r\n]*\r?\n\s*)+)/);
            const leadingComment = leadingCommentMatch ? leadingCommentMatch[1] : '';
            return /@pftr:scopeKey\s+\S/.test(leadingComment);
        };

        for (const sourceFile of getAllFiles(resolvedRootDir)) {
            const lowerSourceFile = sourceFile.toLowerCase();
            if (/\.d\.ts$/i.test(sourceFile) || !sourceExtensions.some((extension) => lowerSourceFile.endsWith(extension))) {
                continue;
            }

            const relativeSourcePath = path.relative(resolvedRootDir, sourceFile);
            const candidateOutputFile = path.join(outDir, relativeSourcePath).replace(/\.[^.]+$/, '.js');
            if (!fs.existsSync(candidateOutputFile)) {
                continue;
            }

            emittedOutputFiles.push(candidateOutputFile);
            if (hasScopeKeyMarker(fs.readFileSync(sourceFile, 'utf8'))) {
                rootOutputFiles.push(candidateOutputFile);
            }
        }

        if (rootOutputFiles.length === 0) {
            // No emitted script declared a scopeKey, so instrument every emitted module.
            filteredOutputFiles = emittedOutputFiles;
        } else {
            const emittedOutputSet = new Set(emittedOutputFiles.map((filePath) => path.resolve(filePath)));
            const collectLocalDependencies = (moduleSource) => {
                const specifiers = new Set();
                const defineMatch = moduleSource.match(/define\(\s*\[(.*?)\]/s);
                if (defineMatch) {
                    for (const match of defineMatch[1].matchAll(/['"](\.[^'"]+)['"]/g)) {
                        specifiers.add(match[1]);
                    }
                }

                for (const match of moduleSource.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
                    specifiers.add(match[1]);
                }

                return specifiers;
            };

            const visited = new Set();
            const queue = [];
            for (const rootFile of rootOutputFiles) {
                const resolvedRootFile = path.resolve(rootFile);
                if (!visited.has(resolvedRootFile)) {
                    visited.add(resolvedRootFile);
                    queue.push(resolvedRootFile);
                }
            }

            while (queue.length > 0) {
                const currentFile = queue.shift();
                let moduleSource;
                try {
                    moduleSource = fs.readFileSync(currentFile, 'utf8');
                } catch (error) {
                    continue;
                }

                const currentDir = path.dirname(currentFile);
                for (const specifier of collectLocalDependencies(moduleSource)) {
                    const dependencyFile = path.resolve(currentDir, `${specifier}.js`);
                    if (visited.has(dependencyFile) || !emittedOutputSet.has(dependencyFile)) {
                        continue;
                    }

                    visited.add(dependencyFile);
                    queue.push(dependencyFile);
                }
            }

            filteredOutputFiles = Array.from(visited);
        }
    } else {
        filteredOutputFiles = getAllFiles(outDir, {
            shouldSkipDir(dirPath) {
                return normalizeSlashes(dirPath) === normalizedWrapperOutputDir;
            },
        }).filter((filePath) => filePath.endsWith('.js'));
    }

    for (const outputFile of filteredOutputFiles) {
        const sourceText = fs.readFileSync(outputFile, 'utf8');
        const instrumentedResult = instrumentationOptions.enabled
            ? transformNetSuiteWrapperSource(sourceText, {
                resourcePath: outputFile,
                rootContext: outDir,
                functionContextModule: toModuleId(outputFile, functionContextModuleFile),
                trackedScriptEntryModule: toModuleId(outputFile, trackedScriptEntryModuleFile),
                instrumentationSource: instrumentationOptions.instrumentationSource,
                moduleFormat: 'amd',
            })
            : null;
        const transformedSourceText = instrumentedResult ? instrumentedResult.code : sourceText;
        const resolveSpecifier = (specifier) => {
            const targetFile = wrapperModules.get(specifier);
            if (!targetFile) {
                return specifier;
            }

            return toModuleId(outputFile, targetFile);
        };

        const rewrittenText = prependAmdDependencies(
            rewriteRequireCalls(rewriteDefineDependencies(transformedSourceText, resolveSpecifier), resolveSpecifier),
            bootstrapFiles.map((bootstrapFile) => toModuleId(outputFile, bootstrapFile)),
        );

        if (rewrittenText !== sourceText) {
            fs.writeFileSync(outputFile, rewrittenText, 'utf8');
        }
    }
}

module.exports = {
    rewriteNetSuiteWrapperTscOutput,
};