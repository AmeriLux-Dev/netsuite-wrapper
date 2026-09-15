const assert = require('node:assert/strict');
const test = require('node:test');

const { transformNetSuiteWrapperSource, parseTrackedScriptOptions } = require('../lib/instrumentation-core');

function transform(source, extraOptions = {}) {
    return transformNetSuiteWrapperSource(source, {
        resourcePath: '/project/src/controllers/userController.ts',
        rootContext: '/project',
        instrumentationSource: 'test',
        ...extraOptions,
    });
}

test('the wrapped body hands the helper the parameter names and the argument values', () => {
    const result = transform('export function loadUser(id, options = {}, ...rest) { return id; }');

    assert.ok(result);
    assert.match(result.code, /parameterNames: \["id", "options", "rest"\]/);
    assert.match(result.code, /\}, \[id, options, rest\]\)/);
});

test('a destructured parameter is named by position and its value left out', () => {
    const result = transform('export const save = ({ id }, [first]) => id + first;');

    assert.match(result.code, /parameterNames: \["arg0", "arg1"\]/);
    assert.match(result.code, /\[void 0, void 0\]\)/);
});

test('@ptrk-ignore-arguments on a function, or at the top of a file, stops argument capture', () => {
    // `other` comes first so the annotation is a function comment, not the file's leading comment.
    const perFunction = transform([
        'export function other(value) { return value; }',
        '/** @ptrk-ignore-arguments */',
        'export function signIn(user, password) { return user; }',
    ].join('\n'));
    assert.doesNotMatch(perFunction.code, /\[user, password\]/);
    assert.doesNotMatch(perFunction.code, /parameterNames: \["user", "password"\]/);
    assert.match(perFunction.code, /\[value\]\)/);

    const wholeFile = transform([
        '/**',
        ' * @NApiVersion 2.1',
        ' * @ptrk-ignore-arguments',
        ' */',
        'export function signIn(user, password) { return user; }',
    ].join('\n'));
    assert.doesNotMatch(wholeFile.code, /\[user, password\]/);
});

test('a default scope key tracks every @NScriptType entry file without a header tag', () => {
    const source = [
        '/**',
        ' * @NApiVersion 2.1',
        ' * @NScriptType Restlet',
        ' */',
        'export function post(body) { return body; }',
    ].join('\n');

    assert.equal(parseTrackedScriptOptions(source), null);
    assert.deepEqual(parseTrackedScriptOptions(source, 'app:demo'), { scopeKey: 'app:demo', scriptType: 'Restlet', entryKind: 'restlet' });

    const untracked = transform(source);
    assert.doesNotMatch(untracked.code, /runTrackedScriptEntry/);

    const tracked = transform(source, { defaultScopeKey: 'app:demo' });
    assert.match(tracked.code, /runTrackedScriptEntry/);
    assert.match(tracked.code, /scopeKey: "app:demo"/);
});

test('the header tag wins over the default scope key, and a file without @NScriptType is never tracked', () => {
    const tagged = '/**\n * @NScriptType Suitelet\n * @pftr:scopeKey app:explicit\n */\nexport function onRequest(context) {}';
    assert.equal(parseTrackedScriptOptions(tagged, 'app:default').scopeKey, 'app:explicit');

    const helper = transform('export function helper(value) { return value; }', { defaultScopeKey: 'app:demo' });
    assert.doesNotMatch(helper.code, /runTrackedScriptEntry/);
});

test('an exported const initialised by a call becomes a tracked entry through wrapTrackedScriptEntryFunction', () => {
    const result = transform([
        '/**',
        ' * @NApiVersion 2.1',
        ' * @NScriptType Restlet',
        ' */',
        "import { defineEndpoints, defineRestlet } from '@amerilux/netsuite-api/server';",
        'const userEndpoints = defineEndpoints({ roles(request) { return request; } });',
        "export const post = defineRestlet({ name: 'user', scriptId: 'customscript_demo_user', deployId: 'customdeploy_demo_user' }, userEndpoints);",
        'export const notAnEntry = 5;',
    ].join('\n'), { defaultScopeKey: 'app:demo' });

    assert.ok(result);
    assert.equal(result.trackedEntryCount, 1);
    assert.match(result.code, /import \{ wrapTrackedScriptEntryFunction as _\w+ \} from "@amerilux\/netsuite-wrapper\/performance-tracker"/);
    assert.match(result.code, /export const post = _\w+\(\{\s*scopeKey: "app:demo",\s*entryKind: "restlet",\s*entryKey: "post"/);
    assert.match(result.code, /\}, defineRestlet\(/);
    assert.match(result.code, /export const notAnEntry = 5;/);
});

test('tsc output assigning a call result onto exports is wrapped the same way, with an AMD binding', () => {
    const result = transform([
        '/**',
        ' * @NApiVersion 2.1',
        ' * @NScriptType Restlet',
        ' */',
        'define(["require", "exports", "@amerilux/netsuite-api/server"], function (require, exports, server_1) {',
        '    "use strict";',
        '    Object.defineProperty(exports, "__esModule", { value: true });',
        '    exports.post = void 0;',
        '    const userEndpoints = (0, server_1.defineEndpoints)({ roles(request) { return request; } });',
        "    exports.post = (0, server_1.defineRestlet)({ name: 'user' }, userEndpoints);",
        '});',
    ].join('\n'), {
        resourcePath: '/project/out/controllers/userController.js',
        functionContextModule: './netsuite-wrapper/function-context',
        trackedScriptEntryModule: './netsuite-wrapper/performance-tracker',
        moduleFormat: 'amd',
        defaultScopeKey: 'app:demo',
    });

    assert.ok(result);
    assert.equal(result.trackedEntryCount, 1);
    assert.match(result.code, /exports\.post = _\w+\(\{/);
    assert.match(result.code, /var _\w+ = _\w+\.wrapTrackedScriptEntryFunction;/);
    assert.match(result.code, /"\.\/netsuite-wrapper\/performance-tracker"/);
    assert.match(result.code, /exports\.post = void 0;/, 'the void 0 placeholder assignment is not a call and stays as is');
});

test('an exported function entry and a call-result entry in one file import both helpers once', () => {
    const result = transform([
        '/**',
        ' * @NScriptType Suitelet',
        ' * @pftr:scopeKey app:mixed',
        ' */',
        'export function onRequest(context) { return context; }',
        'export const also = makeHandler();',
    ].join('\n'));

    const importMatches = result.code.match(/from "@amerilux\/netsuite-wrapper\/performance-tracker"/g) || [];
    assert.equal(importMatches.length, 1);
    assert.match(result.code, /runTrackedScriptEntry as _\w+, wrapTrackedScriptEntryFunction as _\w+/);
});
