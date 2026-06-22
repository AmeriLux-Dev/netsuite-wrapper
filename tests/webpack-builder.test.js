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

test('only instruments tsc-emitted output and leaves vendored non-AMD files untouched', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-scope-'));
    const srcDir = path.join(tempRoot, 'TypeScripts');
    const outDir = path.join(tempRoot, 'FileCabinet', 'SuiteScripts');
    const runtimeDir = path.join(tempRoot, 'runtime');
    const vendorDir = path.join(outDir, 'vendor_bundle');

    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(vendorDir, { recursive: true });

    fs.writeFileSync(path.join(runtimeDir, 'function-context.js'), 'define([], function () { return { withFunctionContext: function (_metadata, work) { return work(); } }; });');
    fs.writeFileSync(path.join(runtimeDir, 'performance-tracker.js'), 'define([], function () { return { createPerformanceTrackerSink: function () { return { runOperation: function (_metadata, work) { return work(); } }; } }; });');

    // A real TypeScript source and its emitted AMD output.
    fs.writeFileSync(path.join(srcDir, 'entry.ts'), 'export function handler() { return 1; }');
    const emittedOutputFile = path.join(outDir, 'entry.js');
    fs.writeFileSync(emittedOutputFile, 'define(["require", "exports"], function (require, exports) { "use strict"; function handler() { return 1; } exports.handler = handler; });');

    // A vendored, non-AMD bundle file that lives in the output tree but is not compiler output.
    const vendorFile = path.join(vendorDir, 'aes.js');
    const vendorSource = 'module.exports = function aes() { return 42; };\n';
    fs.writeFileSync(vendorFile, vendorSource);

    assert.doesNotThrow(() => {
        rewriteNetSuiteWrapperTscOutput({
            outDir,
            rootDir: srcDir,
            runtimeDir,
            wrapperSubdir: 'netsuite-wrapper',
            telemetryBootstrap: false,
        });
    }, 'rewrite should not throw on vendored non-AMD files in the output tree');

    assert.equal(
        fs.readFileSync(vendorFile, 'utf8'),
        vendorSource,
        'vendored non-AMD file should be left untouched',
    );
    assert.match(
        fs.readFileSync(emittedOutputFile, 'utf8'),
        /function-context/,
        'tsc-emitted output should be instrumented',
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('walks from a scopeKey root and leaves unreachable emitted modules untouched', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-graph-'));
    const srcDir = path.join(tempRoot, 'TypeScripts');
    const outDir = path.join(tempRoot, 'FileCabinet', 'SuiteScripts');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });

    fs.writeFileSync(path.join(runtimeDir, 'function-context.js'), 'define([], function () { return { withFunctionContext: function (_metadata, work) { return work(); } }; });');
    fs.writeFileSync(path.join(runtimeDir, 'performance-tracker.js'), 'define([], function () { return { runTrackedScriptEntry: function (_metadata, work) { return work(); }, createPerformanceTrackerSink: function () { return { runOperation: function (_metadata, work) { return work(); } }; } }; });');

    // The root script carries a scopeKey and imports moduleA; moduleB is emitted but never imported.
    fs.writeFileSync(path.join(srcDir, 'root.ts'), '/**\n * @NScriptType Suitelet\n * @pftr:scopeKey app:test\n */\nimport { helperA } from "./moduleA";\nexport function onRequest() { return helperA(); }');
    fs.writeFileSync(path.join(srcDir, 'moduleA.ts'), 'export function helperA() { return 1; }');
    fs.writeFileSync(path.join(srcDir, 'moduleB.ts'), 'export function helperB() { return 2; }');

    fs.writeFileSync(path.join(outDir, 'root.js'), '/**\n * @NScriptType Suitelet\n * @pftr:scopeKey app:test\n */\ndefine(["require", "exports", "./moduleA"], function (require, exports, moduleA_1) { "use strict"; Object.defineProperty(exports, "__esModule", { value: true }); function onRequest() { return (0, moduleA_1.helperA)(); } exports.onRequest = onRequest; });');
    fs.writeFileSync(path.join(outDir, 'moduleA.js'), 'define(["require", "exports"], function (require, exports) { "use strict"; function helperA() { return 1; } exports.helperA = helperA; });');
    const moduleBOutput = path.join(outDir, 'moduleB.js');
    const moduleBSource = 'define(["require", "exports"], function (require, exports) { "use strict"; function helperB() { return 2; } exports.helperB = helperB; });';
    fs.writeFileSync(moduleBOutput, moduleBSource);

    rewriteNetSuiteWrapperTscOutput({
        outDir,
        rootDir: srcDir,
        runtimeDir,
        wrapperSubdir: 'netsuite-wrapper',
        telemetryBootstrap: false,
    });

    assert.equal(
        fs.readFileSync(moduleBOutput, 'utf8'),
        moduleBSource,
        'a module not reachable from any scopeKey root should be left untouched',
    );
    assert.match(
        fs.readFileSync(path.join(outDir, 'moduleA.js'), 'utf8'),
        /function-context|withFunctionContext/,
        'a module imported by the root should be instrumented',
    );
    assert.match(
        fs.readFileSync(path.join(outDir, 'root.js'), 'utf8'),
        /function-context|withFunctionContext|TrackedScriptEntry/,
        'the root script should be instrumented',
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('appends bootstrap dependencies after require/exports so AMD factory params stay aligned', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-amd-order-'));
    const outDir = path.join(tempRoot, 'dist');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'telemetry.js'), 'define([], function () { return { setWrapperTelemetrySink: function () {} }; });');
    fs.writeFileSync(path.join(runtimeDir, 'performance-tracker.js'), 'define([], function () { return { createPerformanceTrackerSink: function () { return { runOperation: function (_metadata, work) { return work(); } }; } }; });');
    fs.writeFileSync(path.join(runtimeDir, 'function-context.js'), 'define([], function () { return { withFunctionContext: function (_metadata, work) { return work(); } }; });');
    fs.writeFileSync(path.join(outDir, 'index.js'), 'define(["require", "exports"], function (require, exports) { "use strict"; function handler() { return 1; } exports.handler = handler; });');

    rewriteNetSuiteWrapperTscOutput({
        outDir,
        runtimeDir,
        wrapperSubdir: 'netsuite-wrapper',
    });

    const output = fs.readFileSync(path.join(outDir, 'index.js'), 'utf8');
    const depsMatch = output.match(/define\(\s*\[([^\]]*)\]/);
    assert.ok(depsMatch, 'expected a define dependency array');
    const deps = Array.from(depsMatch[1].matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]);

    assert.equal(deps[0], 'require', 'require must remain the first dependency to stay aligned with the first factory param');
    assert.equal(deps[1], 'exports', 'exports must remain the second dependency');
    assert.match(deps[deps.length - 1], /netsuite-wrapper\/bootstrap/, 'side-effect bootstrap should be appended at the end of the dependency list');

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('does not attach the bootstrap to imported leaf modules that have nothing instrumented', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-leaf-'));
    const srcDir = path.join(tempRoot, 'TypeScripts');
    const outDir = path.join(tempRoot, 'FileCabinet', 'SuiteScripts');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });

    fs.writeFileSync(path.join(runtimeDir, 'telemetry.js'), 'define([], function () { return { setWrapperTelemetrySink: function () {} }; });');
    fs.writeFileSync(path.join(runtimeDir, 'performance-tracker.js'), 'define([], function () { return { runTrackedScriptEntry: function (_metadata, work) { return work(); }, createPerformanceTrackerSink: function () { return { runOperation: function (_metadata, work) { return work(); } }; } }; });');
    fs.writeFileSync(path.join(runtimeDir, 'function-context.js'), 'define([], function () { return { withFunctionContext: function (_metadata, work) { return work(); } }; });');

    // The root carries a scopeKey and imports a constants-only leaf module that has no functions.
    fs.writeFileSync(path.join(srcDir, 'root.ts'), '/**\n * @NScriptType Suitelet\n * @pftr:scopeKey app:test\n */\nimport { FLAG } from "./constants";\nexport function onRequest() { return FLAG; }');
    fs.writeFileSync(path.join(srcDir, 'constants.ts'), 'export const FLAG = true;');

    fs.writeFileSync(path.join(outDir, 'root.js'), '/**\n * @NScriptType Suitelet\n * @pftr:scopeKey app:test\n */\ndefine(["require", "exports", "./constants"], function (require, exports, constants_1) { "use strict"; Object.defineProperty(exports, "__esModule", { value: true }); function onRequest() { return constants_1.FLAG; } exports.onRequest = onRequest; });');
    const constantsOutput = path.join(outDir, 'constants.js');
    const constantsSource = 'define(["require", "exports"], function (require, exports) { "use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.FLAG = true; });';
    fs.writeFileSync(constantsOutput, constantsSource);

    rewriteNetSuiteWrapperTscOutput({
        outDir,
        rootDir: srcDir,
        runtimeDir,
        wrapperSubdir: 'netsuite-wrapper',
    });

    assert.equal(
        fs.readFileSync(constantsOutput, 'utf8'),
        constantsSource,
        'a constants-only leaf module should be left untouched (no bootstrap dependency)',
    );
    assert.match(
        fs.readFileSync(path.join(outDir, 'root.js'), 'utf8'),
        /netsuite-wrapper\/bootstrap/,
        'the root entry script should still receive the bootstrap dependency',
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('generates a syntactically valid AMD telemetry bootstrap', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-bootstrap-syntax-'));
    const outDir = path.join(tempRoot, 'dist');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'telemetry.js'), 'define([], function () { return { setWrapperTelemetrySink: function () {} }; });');
    fs.writeFileSync(path.join(runtimeDir, 'performance-tracker.js'), 'define([], function () { return { createPerformanceTrackerSink: function () { return { runOperation: function (_metadata, work) { return work(); } }; } }; });');
    fs.writeFileSync(path.join(outDir, 'index.js'), 'define(["require", "exports"], function (require, exports) { "use strict"; exports.flag = true; });');

    rewriteNetSuiteWrapperTscOutput({
        outDir,
        runtimeDir,
        wrapperSubdir: 'netsuite-wrapper',
        instrumentation: false,
    });

    const bootstrapSource = fs.readFileSync(path.join(outDir, 'netsuite-wrapper', 'bootstrap.js'), 'utf8');
    assert.doesNotThrow(
        () => new Function(bootstrapSource),
        'generated bootstrap.js should be syntactically valid JavaScript',
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('makes wrapper modules declare the N/ module they synchronously require', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-preload-'));
    const outDir = path.join(tempRoot, 'dist');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'telemetry.js'), 'define([], function () { return { setWrapperTelemetrySink: function () {}, runWrappedOperation: function (_m, w) { return w(); } }; });');
    fs.writeFileSync(
        path.join(runtimeDir, 'search.js'),
        'define(["require", "exports", "./telemetry"], function (require, exports, telemetry_1) { "use strict"; function getNsSearch() { return require("N/search"); } exports.create = function () { return getNsSearch().create(); }; });',
    );
    fs.writeFileSync(path.join(outDir, 'index.js'), 'define(["require", "exports"], function (require, exports) { "use strict"; exports.flag = true; });');

    rewriteNetSuiteWrapperTscOutput({
        outDir,
        runtimeDir,
        wrapperSubdir: 'netsuite-wrapper',
        telemetryBootstrap: false,
        instrumentation: false,
    });

    const wrapperSearch = fs.readFileSync(path.join(outDir, 'netsuite-wrapper', 'search.js'), 'utf8');
    const depsMatch = wrapperSearch.match(/define\(\s*\[([^\]]*)\]/);
    assert.ok(depsMatch, 'expected a define dependency array in the wrapper search module');
    const deps = Array.from(depsMatch[1].matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]);
    assert.ok(
        deps.includes('N/search'),
        'wrapper search module must declare N/search so its synchronous require resolves at load time',
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('forwards un-instrumented members of the N/ module in wrapper output', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-forward-'));
    const outDir = path.join(tempRoot, 'dist');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'lazy-module.js'), 'define(["require", "exports"], function (require, exports) { "use strict"; exports.forwardModuleExports = function () {}; });');
    fs.writeFileSync(
        path.join(runtimeDir, 'search.js'),
        'define(["require", "exports", "./telemetry"], function (require, exports, telemetry_1) { "use strict"; function getNsSearch() { return require("N/search"); } exports.create = function () { return getNsSearch().create(); }; });',
    );
    fs.writeFileSync(path.join(outDir, 'index.js'), 'define(["require", "exports"], function (require, exports) { "use strict"; exports.flag = true; });');

    rewriteNetSuiteWrapperTscOutput({
        outDir,
        runtimeDir,
        wrapperSubdir: 'netsuite-wrapper',
        telemetryBootstrap: false,
        instrumentation: false,
    });

    const wrapperSearch = fs.readFileSync(path.join(outDir, 'netsuite-wrapper', 'search.js'), 'utf8');
    assert.match(
        wrapperSearch,
        /require\(['"]\.\/lazy-module['"]\)\.forwardModuleExports\(exports,/,
        'wrapper should forward un-instrumented members of its N/ module',
    );

    const deps = Array.from(wrapperSearch.match(/define\(\s*\[([^\]]*)\]/)[1].matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]);
    assert.ok(deps.includes('./lazy-module'), 'wrapper must load ./lazy-module so the forwarding helper is available');
    assert.ok(deps.includes('N/search'), 'wrapper must load N/search so forwarding can read the real module');

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('wraps exported entry functions of an AMD tracked script with the tracked-script entry helper', () => {
    const source = [
        '/**',
        ' * @NApiVersion 2.1',
        ' * @NScriptType MapReduceScript',
        ' * @pftr:scopeKey app:test',
        ' */',
        'define(["require", "exports"], function (require, exports) {',
        '    "use strict";',
        '    Object.defineProperty(exports, "__esModule", { value: true });',
        '    exports.map = exports.getInputData = void 0;',
        '    const getInputData = () => { return []; };',
        '    exports.getInputData = getInputData;',
        '    const map = (context) => { return 1; };',
        '    exports.map = map;',
        '});',
    ].join('\n');

    const result = transformNetSuiteWrapperSource(source, {
        resourcePath: '/project/amx_test.js',
        rootContext: '/project',
        functionContextModule: './netsuite-wrapper/function-context',
        trackedScriptEntryModule: './netsuite-wrapper/performance-tracker',
        instrumentationSource: 'tsc-amd-auto',
        moduleFormat: 'amd',
    });

    assert.ok(result, 'expected the tracked script to be instrumented');
    assert.match(result.code, /runTrackedScriptEntry/, 'exported entry functions should be wrapped with the tracked-script entry helper');
    assert.match(result.code, /performance-tracker/, 'the tracked-script entry module should be imported');
});

test('records tracked entry functions as the root of their observed-function tree', () => {
    const source = [
        '/**',
        ' * @NScriptType MapReduceScript',
        ' * @pftr:scopeKey app:test',
        ' */',
        'define(["require", "exports"], function (require, exports) {',
        '    "use strict";',
        '    exports.getInputData = void 0;',
        '    const helper = (x) => { return x; };',
        '    const getInputData = () => { return helper(1); };',
        '    exports.getInputData = getInputData;',
        '});',
    ].join('\n');

    const result = transformNetSuiteWrapperSource(source, {
        resourcePath: '/project/amx_test.js',
        rootContext: '/project',
        functionContextModule: './netsuite-wrapper/function-context',
        trackedScriptEntryModule: './netsuite-wrapper/performance-tracker',
        instrumentationSource: 'tsc-amd-auto',
        moduleFormat: 'amd',
    });

    assert.ok(result);
    // The entry must still be wrapped as a tracked-script entry...
    assert.match(result.code, /RunTrackedScriptEntry/);
    // ...and must also be recorded as an observed function (parent = none) so it is the root node of
    // the observed-function call tree. Excluding it would orphan its children and make the first child
    // appear as the tree root.
    assert.doesNotMatch(result.code, /functionName: "getInputData"[^}]*excludeFromObservedFunctions: true/);
    assert.doesNotMatch(result.code, /functionName: "helper"[^}]*excludeFromObservedFunctions: true/);
});

test('does not re-instrument already-instrumented output (idempotent)', () => {
    const source = [
        '/**',
        ' * @NScriptType MapReduceScript',
        ' * @pftr:scopeKey app:test',
        ' */',
        'define(["require", "exports"], function (require, exports) {',
        '    "use strict";',
        '    exports.getInputData = void 0;',
        '    const helper = (x) => { return x; };',
        '    const getInputData = async () => { return helper(1); };',
        '    exports.getInputData = getInputData;',
        '});',
    ].join('\n');

    const options = {
        resourcePath: '/project/amx_test.js',
        rootContext: '/project',
        functionContextModule: './netsuite-wrapper/function-context',
        trackedScriptEntryModule: './netsuite-wrapper/performance-tracker',
        instrumentationSource: 'tsc-amd-auto',
        moduleFormat: 'amd',
    };

    const first = transformNetSuiteWrapperSource(source, options);
    assert.ok(first, 'first pass should instrument the file');
    assert.equal((first.code.match(/RunTrackedScriptEntry\(/g) || []).length, 1, 'entry wrapped exactly once');

    const second = transformNetSuiteWrapperSource(first.code, options);
    assert.equal(second, null, 'a second pass over already-instrumented output must be a no-op');
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

test('writes a tsc chunk-log bootstrap that sets the mode when chunk logging is not group', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-chunk-'));
    const outDir = path.join(tempRoot, 'dist');
    const runtimeDir = path.join(tempRoot, 'runtime');

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'log.js'), 'define([], function () { return { setChunkLogMode: function () {} }; });');
    fs.writeFileSync(path.join(outDir, 'index.js'), 'define([], function () { function main() { return 1; } return { main: main }; });');

    rewriteNetSuiteWrapperTscOutput({
        outDir,
        runtimeDir,
        wrapperSubdir: 'netsuite-wrapper',
        telemetryBootstrap: false,
        chunkLogging: 'silent',
        instrumentation: false,
    });

    const bootstrapFile = path.join(outDir, 'netsuite-wrapper', 'chunk-log-bootstrap.js');
    assert.ok(fs.existsSync(bootstrapFile), 'expected a chunk-log bootstrap file to be written');
    assert.match(fs.readFileSync(bootstrapFile, 'utf8'), /setChunkLogMode\(['"]silent['"]\)/);

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

test('chunk logging defaults to group in the resolved config', () => {
    const result = loadNetSuiteWrapperConfig({});

    assert.equal(result.chunkLogging, 'group');
});

test('resolves valid chunkLogging options and rejects unknown values', () => {
    assert.equal(loadNetSuiteWrapperConfig({ chunkLogging: 'silent' }).chunkLogging, 'silent');
    assert.equal(loadNetSuiteWrapperConfig({ chunkLogging: 'off' }).chunkLogging, 'off');
    assert.equal(loadNetSuiteWrapperConfig({ chunkLogging: 'bogus' }).chunkLogging, 'group');
});

test('prepends the trace-log bootstrap to webpack entries when trace logging is on', () => {
    const traceBootstrapPath = path.join(__dirname, '..', 'lib', 'trace-log-bootstrap.js');
    const result = createNetSuiteWrapperWebpackEntries('./src/index.ts', {
        telemetryBootstrap: false,
        traceLog: true,
    });

    assert.deepEqual(result, [traceBootstrapPath, './src/index.ts']);
});

test('prepends the matching chunk-log bootstrap to webpack entries for a non-group mode', () => {
    const silentBootstrapPath = path.join(__dirname, '..', 'lib', 'chunk-log-bootstrap-silent.js');
    const result = createNetSuiteWrapperWebpackEntries('./src/index.ts', {
        telemetryBootstrap: false,
        chunkLogging: 'silent',
    });

    assert.deepEqual(result, [silentBootstrapPath, './src/index.ts']);
});

test('prepends the off chunk-log bootstrap to webpack entries when chunk logging is off', () => {
    const offBootstrapPath = path.join(__dirname, '..', 'lib', 'chunk-log-bootstrap-off.js');
    const result = createNetSuiteWrapperWebpackEntries('./src/index.ts', {
        telemetryBootstrap: false,
        chunkLogging: 'off',
    });

    assert.deepEqual(result, [offBootstrapPath, './src/index.ts']);
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

test('rollup prepends a chunk-log bootstrap import to entries for a non-group mode', () => {
    const plugin = builderRollup.createNetSuiteWrapperRollupPlugin({
        telemetryBootstrap: false,
        chunkLogging: 'silent',
        instrumentation: false,
    });
    const entryId = path.resolve('./src/index.ts');

    plugin.options({ input: entryId });
    const transformed = plugin.transform('export const value = 1;', entryId);

    assert.ok(transformed, 'expected the entry to be rewritten with a bootstrap import');
    assert.match(transformed.code, /import "virtual:netsuite-wrapper:chunk-log-bootstrap";/);
});

test('rollup resolves and loads a chunk-log bootstrap that sets the mode', () => {
    const plugin = builderRollup.createNetSuiteWrapperRollupPlugin({
        telemetryBootstrap: false,
        chunkLogging: 'off',
    });

    const resolvedBootstrapId = plugin.resolveId('virtual:netsuite-wrapper:chunk-log-bootstrap');
    const bootstrapSource = plugin.load(resolvedBootstrapId);

    assert.match(bootstrapSource, /setChunkLogMode\(['"]off['"]\)/);
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

test('silent chunk-log bootstrap sets silent mode through a real log module file', () => {
    const bootstrapPath = path.join(__dirname, '..', 'lib', 'chunk-log-bootstrap-silent.js');
    const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
    const match = bootstrapSource.match(/require\((['"])(\.[^'"]*log\.js)\1\)/);

    assert.ok(match, 'expected chunk-log-bootstrap-silent.js to require log.js by relative path');

    const resolvedLogPath = path.resolve(path.dirname(bootstrapPath), match[2]);
    assert.ok(
        fs.existsSync(resolvedLogPath),
        `log require resolves to a missing file: ${resolvedLogPath}`,
    );

    assert.match(bootstrapSource, /setChunkLogMode\(['"]silent['"]\)/);
});

test('off chunk-log bootstrap sets off mode through a real log module file', () => {
    const bootstrapPath = path.join(__dirname, '..', 'lib', 'chunk-log-bootstrap-off.js');
    const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
    const match = bootstrapSource.match(/require\((['"])(\.[^'"]*log\.js)\1\)/);

    assert.ok(match, 'expected chunk-log-bootstrap-off.js to require log.js by relative path');

    const resolvedLogPath = path.resolve(path.dirname(bootstrapPath), match[2]);
    assert.ok(
        fs.existsSync(resolvedLogPath),
        `log require resolves to a missing file: ${resolvedLogPath}`,
    );

    assert.match(bootstrapSource, /setChunkLogMode\(['"]off['"]\)/);
});

test('legacy root entrypoints re-export the builder implementations', () => {
    assert.equal(legacyRollup, builderRollup);
    assert.equal(legacyWebpack, builderWebpack);
    assert.equal(legacyTsc, builderTsc);
    assert.equal(legacyInstrumentationLoader, builderInstrumentationLoader);
});