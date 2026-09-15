const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    loadNetSuiteWrapperConfig,
    resolveDefaultScopeKey,
    resolveExporterSettings,
    resolveHttpsExport,
    resolveTelemetryBootstrap,
} = require('../lib/build-support');
const { createNetSuiteWrapperRollupPlugin } = require('../builders/rollup');
const { rewriteNetSuiteWrapperTscOutput } = require('../builders/tsc');

test('the performance-tracker integration keeps the scope key and exporter settings from the config', () => {
    const resolved = resolveTelemetryBootstrap('/project', {
        integration: 'performance-tracker',
        scopeKey: ' app:demo ',
        httpsExport: { url: 'https://collector.example.com/ingest', secretId: 'custsecret_demo', headers: { 'X-Tenant': 'amerilux', bad: 5 } },
    });

    assert.equal(resolved.sinkModule, '@amerilux/netsuite-wrapper/performance-tracker');
    assert.equal(resolved.scopeKey, 'app:demo');
    assert.equal(resolved.recordExport, true);
    assert.deepEqual(resolved.httpsExport, {
        url: 'https://collector.example.com/ingest',
        secretId: 'custsecret_demo',
        headers: { 'X-Tenant': 'amerilux' },
    });
});

test('recordExport can be switched off and httpsExport without a url is ignored', () => {
    const resolved = resolveTelemetryBootstrap('/project', { integration: 'performance-tracker', recordExport: false, httpsExport: { secretId: 'x' } });
    assert.equal(resolved.recordExport, false);
    assert.equal(resolved.httpsExport, null);
    assert.equal(resolveHttpsExport('https://not-an-object'), null);
    assert.deepEqual(resolveExporterSettings(resolved), { recordExport: false, httpsExport: null });
    assert.equal(resolveExporterSettings(null), null);
});

test('the default configuration still means performance-tracker with the record exporter and no scope key', () => {
    const resolved = resolveTelemetryBootstrap('/project', undefined);
    assert.equal(resolved.scopeKey, '');
    assert.equal(resolved.recordExport, true);
    assert.equal(resolved.httpsExport, null);
});

test('the default scope key comes from the config file, and instrumentation.defaultScopeKey overrides it', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nsw-config-'));
    const configPath = path.join(tempRoot, 'netsuite-wrapper.config.js');
    fs.writeFileSync(configPath, "module.exports = { telemetryBootstrap: { integration: 'performance-tracker', scopeKey: 'app:from-config' } };");

    try {
        assert.equal(loadNetSuiteWrapperConfig({ configPath }).telemetryBootstrap.scopeKey, 'app:from-config');
        assert.equal(resolveDefaultScopeKey({ configPath }), 'app:from-config');
        assert.equal(resolveDefaultScopeKey({ configPath, instrumentation: { defaultScopeKey: 'app:override' } }), 'app:override');
        assert.equal(resolveDefaultScopeKey({ configPath, telemetryBootstrap: false }), '');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('the rollup bootstrap module registers the configured exporters before creating the sink', () => {
    const plugin = createNetSuiteWrapperRollupPlugin({
        telemetryBootstrap: {
            integration: 'performance-tracker',
            scopeKey: 'app:demo',
            httpsExport: { url: 'https://collector.example.com/ingest', secretId: 'custsecret_demo' },
        },
    });

    const bootstrapSource = plugin.load('\0netsuite-wrapper:auto-bootstrap');
    assert.match(bootstrapSource, /import \{ registerTelemetryExporter \} from "virtual:netsuite-wrapper:telemetry-exporter-module"/);
    assert.match(bootstrapSource, /registerTelemetryExporter\(createNetSuiteRecordExporter\(\)\)/);
    assert.match(bootstrapSource, /registerTelemetryExporter\(createHttpsExporter\(\{"url":"https:\/\/collector\.example\.com\/ingest","secretId":"custsecret_demo"\}\)\)/);
    assert.match(bootstrapSource, /const sinkOptions = "app:demo" \|\| undefined;/);
    assert.equal(plugin.resolveId('virtual:netsuite-wrapper:https-exporter-module'), '@amerilux/netsuite-wrapper/https-exporter');

    const recordOnly = createNetSuiteWrapperRollupPlugin({ telemetryBootstrap: { integration: 'performance-tracker' } });
    const recordOnlySource = recordOnly.load('\0netsuite-wrapper:auto-bootstrap');
    assert.match(recordOnlySource, /createNetSuiteRecordExporter/);
    assert.doesNotMatch(recordOnlySource, /createHttpsExporter/);
});

test('the tsc bootstrap declares the exporter modules as AMD dependencies, and a default scope key makes @NScriptType files roots', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nsw-tsc-exporters-'));
    const srcDir = path.join(tempRoot, 'src');
    const outDir = path.join(tempRoot, 'out');
    const runtimeDir = path.join(tempRoot, 'runtime');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });

    for (const runtimeFile of ['telemetry', 'performance-tracker', 'function-context', 'telemetry-exporter', 'netsuite-record-exporter', 'https-exporter']) {
        fs.writeFileSync(path.join(runtimeDir, `${runtimeFile}.js`), 'define([], function () { return {}; });');
    }

    // No @pftr:scopeKey anywhere: only the default scope key can make root.ts a root.
    fs.writeFileSync(path.join(srcDir, 'root.ts'), '/**\n * @NScriptType Restlet\n */\nimport { helperA } from "./moduleA";\nexport const post = helperA();');
    fs.writeFileSync(path.join(srcDir, 'moduleA.ts'), 'export function helperA() { return () => 1; }');
    fs.writeFileSync(path.join(srcDir, 'moduleB.ts'), 'export function helperB() { return 2; }');
    fs.writeFileSync(path.join(outDir, 'root.js'), '/**\n * @NScriptType Restlet\n */\ndefine(["require", "exports", "./moduleA"], function (require, exports, moduleA_1) { "use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.post = void 0; exports.post = (0, moduleA_1.helperA)(); });');
    fs.writeFileSync(path.join(outDir, 'moduleA.js'), 'define(["require", "exports"], function (require, exports) { "use strict"; function helperA() { return function () { return 1; }; } exports.helperA = helperA; });');
    const moduleBSource = 'define(["require", "exports"], function (require, exports) { "use strict"; function helperB() { return 2; } exports.helperB = helperB; });';
    fs.writeFileSync(path.join(outDir, 'moduleB.js'), moduleBSource);

    try {
        rewriteNetSuiteWrapperTscOutput({
            outDir,
            rootDir: srcDir,
            runtimeDir,
            wrapperSubdir: 'netsuite-wrapper',
            telemetryBootstrap: {
                integration: 'performance-tracker',
                scopeKey: 'app:demo',
                httpsExport: { url: 'https://collector.example.com/ingest' },
            },
        });

        const bootstrapSource = fs.readFileSync(path.join(outDir, 'netsuite-wrapper', 'bootstrap.js'), 'utf8');
        assert.match(bootstrapSource, /define\(\["\.\/telemetry", "\.\/performance-tracker", "\.\/telemetry-exporter", "\.\/netsuite-record-exporter", "\.\/https-exporter"\]/);
        assert.match(bootstrapSource, /registerTelemetryExporter\(recordExporterModule\.createNetSuiteRecordExporter\(\)\)/);
        assert.match(bootstrapSource, /createHttpsExporter\(\{"url":"https:\/\/collector\.example\.com\/ingest"\}\)/);

        const rootOutput = fs.readFileSync(path.join(outDir, 'root.js'), 'utf8');
        assert.match(rootOutput, /wrapTrackedScriptEntryFunction/, 'the call-result entry should be wrapped');
        assert.match(rootOutput, /scopeKey: "app:demo"/);
        assert.match(rootOutput, /netsuite-wrapper\/bootstrap/);
        assert.equal(fs.readFileSync(path.join(outDir, 'moduleB.js'), 'utf8'), moduleBSource, 'a module not reachable from the root stays untouched');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
