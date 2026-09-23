const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const { listOverrideModules } = require('../lib/override-modules');

// Every N module stands in as a proxy answering one marker per member, so a wrapper member forwarded to
// its N module reads back that module's own marker.
const markers = new Map();
const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request) {
    if (/^N\//.test(request)) {
        return new Proxy({}, {
            get: (_target, member) => {
                const key = `${request}.${String(member)}`;
                if (!markers.has(key)) {
                    markers.set(key, { marker: key });
                }
                return markers.get(key);
            },
        });
    }

    return originalModuleLoad.apply(this, arguments);
};

const typesDir = path.join(__dirname, '..', 'node_modules', '@hitc', 'netsuite-types', 'N');

/** The values an N module's type declarations export: enums, functions, constants and aliased exports such as `delete`. */
function declaredValueMembers(moduleName) {
    const declarations = fs.readFileSync(path.join(typesDir, `${moduleName}.d.ts`), 'utf8');
    const declared = [...declarations.matchAll(/^export (?:declare )?(?:const enum|enum|function|const|let|var|class) ([A-Za-z_$][\w$]*)/gm)].map((match) => match[1]);
    const aliased = [...declarations.matchAll(/^export \{ [A-Za-z_$][\w$]* as ([A-Za-z_$][\w$]*) \};?/gm)].map((match) => match[1]);
    return [...new Set([...declared, ...aliased])];
}

// Build tools replace every import of a wrapped N module with its wrapper, so the wrapper has to answer every
// member the N module has: the ones it instruments, and every other one forwarded as it is.
const wrappedNetSuiteModules = listOverrideModules().filter((moduleName) => fs.existsSync(path.join(typesDir, `${moduleName}.d.ts`)));

test('the wrapped N modules are found', () => {
    assert.deepEqual(wrappedNetSuiteModules, ['https', 'log', 'query', 'record', 'runtime', 'search', 'task', 'url']);
});

for (const moduleName of wrappedNetSuiteModules) {
    const wrapper = require(`../dist/${moduleName}`);
    for (const member of declaredValueMembers(moduleName)) {
        test(`${moduleName} answers N/${moduleName}'s ${member}`, () => {
            assert.notEqual(wrapper[member], undefined);
        });
    }
}

test('a forwarded member is the N module\'s own', () => {
    const query = require('../dist/query');
    assert.equal(query.Operator, markers.get('N/query.Operator'));
    assert.equal(query.FieldContext, markers.get('N/query.FieldContext'));
});
