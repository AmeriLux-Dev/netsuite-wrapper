const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    createNetSuiteWrapperWebpackEntries,
} = require('../builders/webpack');
const builderInstrumentationLoader = require('../builders/instrumentation-loader');
const builderRollup = require('../builders/rollup');
const builderTsc = require('../builders/tsc');
const builderWebpack = require('../builders/webpack');
const legacyInstrumentationLoader = require('../instrumentation-loader');
const legacyRollup = require('../rollup-plugin');
const legacyTsc = require('../tsc-plugin');
const legacyWebpack = require('../webpack-plugin');
const { rewriteNetSuiteWrapperTscOutput } = require('../builders/tsc');
const { loadNetSuiteWrapperConfig } = require('../lib/build-support');
const { transformNetSuiteWrapperSource } = require('../lib/instrumentation-core');

function createOptions(extraOptions = {}) {
    return {
        telemetryBootstrap: false,
        bootstrapModules: ['bootstrap-a.js', 'bootstrap-b.js'],
        ...extraOptions,
    };
}

test('prepends bootstrap modules to a string entry', () => {
    const result = createNetSuiteWrapperWebpackEntries('./src/index.ts', createOptions());

    assert.deepEqual(result, ['bootstrap-a.js', 'bootstrap-b.js', './src/index.ts']);
});

test('prepends bootstrap modules to an array entry without duplicating existing modules', () => {
    const result = createNetSuiteWrapperWebpackEntries([
        'bootstrap-a.js',
        './src/index.ts',
    ], createOptions());

    assert.deepEqual(result, ['bootstrap-b.js', 'bootstrap-a.js', './src/index.ts']);
});

test('prepends bootstrap modules to each entry in an entry map', () => {
    const result = createNetSuiteWrapperWebpackEntries({
        main: './src/index.ts',
        secondary: ['./src/secondary.ts'],
    }, createOptions());

    assert.deepEqual(result, {
        main: ['bootstrap-a.js', 'bootstrap-b.js', './src/index.ts'],
        secondary: ['bootstrap-a.js', 'bootstrap-b.js', './src/secondary.ts'],
    });
});

test('preserves descriptor fields while prepending bootstrap modules to descriptor imports', () => {
    const result = createNetSuiteWrapperWebpackEntries({
        main: {
            import: './src/index.ts',
            filename: 'main.js',
            runtime: 'runtime',
        },
    }, createOptions());

    assert.deepEqual(result, {
        main: {
            import: ['bootstrap-a.js', 'bootstrap-b.js', './src/index.ts'],
            filename: 'main.js',
            runtime: 'runtime',
        },
    });
});

test('wraps function entries and rewrites their resolved entry values', async () => {
    const result = createNetSuiteWrapperWebpackEntries(async () => ({
        main: {
            import: ['./src/index.ts'],
            filename: 'main.js',
        },
    }), createOptions());

    assert.equal(typeof result, 'function');
    assert.deepEqual(await result(), {
        main: {
            import: ['bootstrap-a.js', 'bootstrap-b.js', './src/index.ts'],
            filename: 'main.js',
        },
    });
});

test('resolves default telemetry bootstrap through a custom package name', () => {
    const result = loadNetSuiteWrapperConfig({
        packageName: '@custom/netsuite-wrapper',
    });

    assert.equal(result.telemetryBootstrap.sinkModule, '@custom/netsuite-wrapper/performance-tracker');
});

test('uses the configured package name for default instrumentation helper imports', () => {
    const source = 'export function runSomething() { return 1; }';
    const result = transformNetSuiteWrapperSource(source, {
        resourcePath: '/repo/src/example.ts',
        rootContext: '/repo',
        packageName: '@custom/netsuite-wrapper',
    });

    assert.ok(result);
    assert.match(result.code, /@custom\/netsuite-wrapper\/function-context/);
});

test('keeps the tsc bootstrap path on the local runtime when packageName is customized', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-tsc-'));
    const outDir = path.join(tempRoot, 'dist');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'telemetry.js'), 'define([], function () { return { setWrapperTelemetrySink: function () {} }; });');
    fs.writeFileSync(path.join(runtimeDir, 'performance-tracker.js'), 'define([], function () { return { createPerformanceTrackerSink: function () { return { runOperation: function (_metadata, work) { return work(); } }; } }; });');
    fs.writeFileSync(path.join(runtimeDir, 'function-context.js'), 'define([], function () { return { withFunctionContext: function (_metadata, work) { return work(); } }; });');
    fs.writeFileSync(path.join(outDir, 'index.js'), 'define([], function () { function main() { return 1; } return { main: main }; });');

    assert.doesNotThrow(() => {
        rewriteNetSuiteWrapperTscOutput({
            outDir,
            runtimeDir,
            wrapperSubdir: 'netsuite-wrapper',
            packageName: '@custom/netsuite-wrapper',
            instrumentation: false,
        });
    });

    assert.ok(fs.existsSync(path.join(outDir, 'netsuite-wrapper', 'bootstrap.js')));
    assert.match(fs.readFileSync(path.join(outDir, 'netsuite-wrapper', 'bootstrap.js'), 'utf8'), /\.\/performance-tracker/);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('writes a tsc trace-log bootstrap that enables tracing when trace logging is on', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-trace-'));
    const outDir = path.join(tempRoot, 'dist');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'log.js'), 'define([], function () { return { setTraceLogEnabled: function () {} }; });');
    fs.writeFileSync(path.join(outDir, 'index.js'), 'define([], function () { function main() { return 1; } return { main: main }; });');

    rewriteNetSuiteWrapperTscOutput({
        outDir,
        runtimeDir,
        wrapperSubdir: 'netsuite-wrapper',
        telemetryBootstrap: false,
        traceLog: true,
        instrumentation: false,
    });

    const bootstrapFile = path.join(outDir, 'netsuite-wrapper', 'trace-log-bootstrap.js');
    assert.ok(fs.existsSync(bootstrapFile), 'expected a trace-log bootstrap file to be written');
    assert.match(fs.readFileSync(bootstrapFile, 'utf8'), /setTraceLogEnabled\(true\)/);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('webpack bootstrap telemetry require resolves to a real file', () => {
    const bootstrapPath = path.join(__dirname, '..', 'lib', 'webpack-bootstrap.js');
    const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
    const match = bootstrapSource.match(/require\((['"])(\.[^'"]*telemetry\.js)\1\)/);

    assert.ok(match, 'expected webpack-bootstrap.js to require telemetry.js by relative path');

    const resolvedTelemetryPath = path.resolve(path.dirname(bootstrapPath), match[2]);
    assert.ok(
        fs.existsSync(resolvedTelemetryPath),
        `telemetry require resolves to a missing file: ${resolvedTelemetryPath}`,
    );
});

test('trace logging defaults to off in the resolved config', () => {
    const result = loadNetSuiteWrapperConfig({});

    assert.equal(result.traceLog, false);
});

test('prepends the trace-log bootstrap to webpack entries when trace logging is on', () => {
    const traceBootstrapPath = path.join(__dirname, '..', 'lib', 'trace-log-bootstrap.js');
    const result = createNetSuiteWrapperWebpackEntries('./src/index.ts', {
        telemetryBootstrap: false,
        traceLog: true,
    });

    assert.deepEqual(result, [traceBootstrapPath, './src/index.ts']);
});

test('trace-log bootstrap enables tracing through a real log module file', () => {
    const bootstrapPath = path.join(__dirname, '..', 'lib', 'trace-log-bootstrap.js');
    const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
    const match = bootstrapSource.match(/require\((['"])(\.[^'"]*log\.js)\1\)/);

    assert.ok(match, 'expected trace-log-bootstrap.js to require log.js by relative path');

    const resolvedLogPath = path.resolve(path.dirname(bootstrapPath), match[2]);
    assert.ok(
        fs.existsSync(resolvedLogPath),
        `log require resolves to a missing file: ${resolvedLogPath}`,
    );

    assert.match(bootstrapSource, /setTraceLogEnabled\(true\)/);
});

test('rollup prepends a trace-log bootstrap import to entries when trace logging is on', () => {
    const plugin = builderRollup.createNetSuiteWrapperRollupPlugin({
        telemetryBootstrap: false,
        traceLog: true,
        instrumentation: false,
    });
    const entryId = path.resolve('./src/index.ts');

    plugin.options({ input: entryId });
    const transformed = plugin.transform('export const value = 1;', entryId);

    assert.ok(transformed, 'expected the entry to be rewritten with a bootstrap import');
    assert.match(transformed.code, /import "virtual:netsuite-wrapper:trace-log-bootstrap";/);
});

test('rollup resolves and loads a trace-log bootstrap that enables tracing', () => {
    const plugin = builderRollup.createNetSuiteWrapperRollupPlugin({
        telemetryBootstrap: false,
        traceLog: true,
        packageName: '@custom/netsuite-wrapper',
    });

    const resolvedBootstrapId = plugin.resolveId('virtual:netsuite-wrapper:trace-log-bootstrap');
    const bootstrapSource = plugin.load(resolvedBootstrapId);

    assert.match(bootstrapSource, /setTraceLogEnabled\(true\)/);

    const resolvedLogId = plugin.resolveId('virtual:netsuite-wrapper:log-module');
    assert.equal(resolvedLogId, '@custom/netsuite-wrapper/log');
});

test('legacy root entrypoints re-export the builder implementations', () => {
    assert.equal(legacyRollup, builderRollup);
    assert.equal(legacyWebpack, builderWebpack);
    assert.equal(legacyTsc, builderTsc);
    assert.equal(legacyInstrumentationLoader, builderInstrumentationLoader);
});