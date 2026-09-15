const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const httpsCalls = [];
const secureStrings = [];
const nsLogCalls = [];
let responseCode = 202;

const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request) {
    if (request === 'N/https') {
        return {
            post(options) {
                httpsCalls.push(options);
                return { code: responseCode, body: '' };
            },
            createSecureString(options) {
                const secureString = { kind: 'SecureString', input: options.input };
                secureStrings.push(secureString);
                return secureString;
            },
        };
    }

    if (request === 'N/runtime') {
        return {
            envType: 'SANDBOX',
            accountId: '123456_SB1',
            getCurrentScript() {
                return { id: 'customscript_demo_user', deploymentId: 'customdeploy_demo_user' };
            },
        };
    }

    if (request === 'N/log') {
        return { error: (options) => nsLogCalls.push(options) };
    }

    return originalModuleLoad.apply(this, arguments);
};

const { createHttpsExporter } = require('../dist/https-exporter');

function makeBatch() {
    return {
        executionId: 'exec_1',
        flowId: 'flow_1',
        scopeKey: 'app:demo',
        mode: 'boundary',
        spans: [{ executionId: 'exec_1', spanRole: 'entry', status: 'SUCCESS' }],
        logs: [{ level: 'audit', title: 'endpoint completed', details: { status: 200 } }],
    };
}

test.beforeEach(() => {
    httpsCalls.length = 0;
    secureStrings.length = 0;
    nsLogCalls.length = 0;
    responseCode = 202;
});

test('requires a url', () => {
    assert.throws(() => createHttpsExporter({ url: '  ' }), /requires a url/);
});

test('posts one JSON document per batch with the run context and both spans and logs', () => {
    const exporter = createHttpsExporter({ url: 'https://collector.example.com/ingest' });
    assert.equal(exporter.name, 'https');
    assert.equal(exporter.acceptsLogEntries, true);

    exporter.export(makeBatch());

    assert.equal(httpsCalls.length, 1);
    const call = httpsCalls[0];
    assert.equal(call.url, 'https://collector.example.com/ingest');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.headers.Authorization, undefined);
    const payload = JSON.parse(call.body);
    assert.equal(payload.source, 'netsuite-wrapper');
    assert.equal(payload.environment, 'SANDBOX');
    assert.equal(payload.accountId, '123456_SB1');
    assert.equal(payload.scriptId, 'customscript_demo_user');
    assert.equal(payload.deploymentId, 'customdeploy_demo_user');
    assert.equal(payload.executionId, 'exec_1');
    assert.equal(payload.scopeKey, 'app:demo');
    assert.equal(payload.mode, 'boundary');
    assert.equal(payload.spans.length, 1);
    assert.equal(payload.logs.length, 1);
    assert.match(payload.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('the token is referenced by API secret id inside a SecureString, never as a literal', () => {
    const exporter = createHttpsExporter({ url: 'https://collector.example.com/ingest', secretId: 'custsecret_demo_telemetry' });

    exporter.export(makeBatch());

    assert.equal(secureStrings.length, 1);
    assert.equal(secureStrings[0].input, 'Bearer {custsecret_demo_telemetry}');
    assert.equal(httpsCalls[0].headers.Authorization, secureStrings[0]);
    assert.equal(httpsCalls[0].body.includes('custsecret_demo_telemetry'), false);
});

test('header name, scheme, extra headers, source and payload format are configurable', () => {
    const exporter = createHttpsExporter({
        url: 'https://collector.example.com/ingest',
        secretId: 'custsecret_key',
        authorizationHeader: 'X-Api-Key',
        authorizationScheme: '',
        headers: { 'X-Tenant': 'amerilux' },
        source: 'demo-app',
        format: (payload) => ({ events: payload.logs, meta: { source: payload.source } }),
    });

    exporter.export(makeBatch());

    const call = httpsCalls[0];
    assert.equal(secureStrings[0].input, '{custsecret_key}');
    assert.equal(call.headers['X-Api-Key'], secureStrings[0]);
    assert.equal(call.headers['X-Tenant'], 'amerilux');
    assert.deepEqual(JSON.parse(call.body), { events: makeBatch().logs, meta: { source: 'demo-app' } });
});

test('a rejected request is logged once and does not throw', () => {
    responseCode = 401;
    const exporter = createHttpsExporter({ url: 'https://collector.example.com/ingest' });

    assert.doesNotThrow(() => exporter.export(makeBatch()));

    assert.equal(nsLogCalls.length, 1);
    assert.equal(nsLogCalls[0].title, 'netsuite-wrapper https export rejected');
    assert.match(nsLogCalls[0].details, /"code":401/);
});
