const fs = require('fs');
const path = require('path');

const EXCLUDED_MODULE_PATHS = new Set([
    'index',
    'performance-tracker',
    'telemetry',
]);

function normalizeSlashes(value) {
    return value.replace(/\\/g, '/');
}

function getAllFiles(rootDir) {
    const results = [];

    if (!fs.existsSync(rootDir)) {
        return results;
    }

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            results.push(...getAllFiles(fullPath));
        } else {
            results.push(fullPath);
        }
    }

    return results;
}

function collectModulePaths(rootDir, extension) {
    return getAllFiles(rootDir)
        .filter((filePath) => filePath.endsWith(extension))
        .map((filePath) => normalizeSlashes(path.relative(rootDir, filePath)).slice(0, -extension.length))
        .filter((modulePath) => !modulePath.endsWith('.d'))
        .filter((modulePath) => !EXCLUDED_MODULE_PATHS.has(modulePath));
}

function getOverrideModuleRootCandidates(projectRoot) {
    return [
        {
            rootDir: path.join(projectRoot, 'src'),
            extension: '.ts',
            include: (modulePath) => !modulePath.includes('/'),
        },
        // `src` is not part of the published package (see the "files" allowlist), so an installed copy
        // has no TypeScript sources to scan. Fall back to the shipped `amd-runtime` build, which is the
        // actual set of wrapper modules that override NetSuite modules.
        {
            rootDir: path.join(projectRoot, 'amd-runtime'),
            extension: '.js',
            include: (modulePath) => !modulePath.includes('/'),
        },
    ];
}

function listOverrideModules(projectRoot = path.resolve(__dirname, '..')) {
    for (const candidate of getOverrideModuleRootCandidates(projectRoot)) {
        const modulePaths = collectModulePaths(candidate.rootDir, candidate.extension)
            .filter((modulePath) => !candidate.include || candidate.include(modulePath));
        if (modulePaths.length > 0) {
            return Array.from(new Set(modulePaths)).sort();
        }
    }

    return [];
}

function listOverrideSpecifiers(projectRoot = path.resolve(__dirname, '..')) {
    return listOverrideModules(projectRoot).map((modulePath) => `N/${modulePath}`);
}

module.exports = {
    listOverrideModules,
    listOverrideSpecifiers,
};