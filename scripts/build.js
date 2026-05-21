const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const shouldTypecheckOnly = process.argv.includes('--noEmit');
const projectArgIndex = process.argv.indexOf('--project');
const projectFile = projectArgIndex >= 0 && process.argv[projectArgIndex + 1]
    ? process.argv[projectArgIndex + 1]
    : 'tsconfig.json';

function resolveBinary(relativePaths, fallbackCommand) {
    for (const relativePath of relativePaths) {
        const fullPath = path.join(projectRoot, relativePath);
        if (fs.existsSync(fullPath)) {
            return `"${fullPath}"`;
        }
    }

    return fallbackCommand;
}

const typescriptCli = resolveBinary([
    path.join('node_modules', '.bin', 'tsc'),
], 'npx tsc');

const command = shouldTypecheckOnly
    ? `${typescriptCli} -p ${projectFile} --noEmit`
    : `${typescriptCli} -p ${projectFile}`;

function getOutDir(projectPath) {
    const configPath = path.join(projectRoot, projectPath);
    if (!fs.existsSync(configPath)) {
        return null;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const outDir = config && config.compilerOptions && config.compilerOptions.outDir;
    return typeof outDir === 'string' ? path.resolve(projectRoot, outDir) : null;
}

if (!shouldTypecheckOnly) {
    const outDir = getOutDir(projectFile);
    if (outDir && fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true, force: true });
    }
}

console.log(`Executing: ${command} in ${projectRoot}`);
execSync(command, { stdio: 'inherit', cwd: projectRoot });