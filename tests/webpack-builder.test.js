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

test('legacy root entrypoints re-export the builder implementations', () => {
    assert.equal(legacyRollup, builderRollup);
    assert.equal(legacyWebpack, builderWebpack);
    assert.equal(legacyTsc, builderTsc);
    assert.equal(legacyInstrumentationLoader, builderInstrumentationLoader);
});