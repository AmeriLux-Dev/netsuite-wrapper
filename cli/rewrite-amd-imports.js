const { rewriteNetSuiteWrapperTscOutput } = require('../builders/tsc');

function getArgValue(name) {
    const args = process.argv.slice(2);
    const prefix = `${name}=`;
    const directMatch = args.find((arg) => arg.startsWith(prefix));

    if (directMatch) {
        return directMatch.slice(prefix.length);
    }

    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1]) {
        return args[index + 1];
    }

    return undefined;
}

function main() {
    rewriteNetSuiteWrapperTscOutput({
        outDir: getArgValue('--outDir'),
        runtimeDir: getArgValue('--runtimeDir'),
        wrapperSubdir: getArgValue('--wrapperSubdir') || 'netsuite-wrapper',
        rootDir: getArgValue('--rootDir'),
        configPath: getArgValue('--config'),
        instrumentation: !process.argv.includes('--noInstrumentation'),
    });
}

if (require.main === module) {
    main();
}

module.exports = {
    main,
};