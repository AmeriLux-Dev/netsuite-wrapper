const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listOverrideSpecifiers } = require('../lib/override-modules');

test('derives override specifiers from amd-runtime when src is not shipped (installed package layout)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-wrapper-override-'));
    const amdRuntimeDir = path.join(root, 'amd-runtime');
    fs.mkdirSync(amdRuntimeDir, { recursive: true });
    for (const moduleName of ['record', 'log', 'search', 'runtime', 'url', 'index', 'telemetry', 'performance-tracker']) {
        fs.writeFileSync(path.join(amdRuntimeDir, `${moduleName}.js`), 'define([], function () {});');
    }

    const specifiers = listOverrideSpecifiers(root);

    for (const expected of ['N/record', 'N/log', 'N/search', 'N/runtime', 'N/url']) {
        assert.ok(specifiers.includes(expected), `expected override specifiers to include ${expected}`);
    }
    // Internal-only runtime modules must not be treated as NetSuite overrides.
    assert.ok(!specifiers.includes('N/index'), 'index must be excluded');
    assert.ok(!specifiers.includes('N/telemetry'), 'telemetry must be excluded');
    assert.ok(!specifiers.includes('N/performance-tracker'), 'performance-tracker must be excluded');

    fs.rmSync(root, { recursive: true, force: true });
});
