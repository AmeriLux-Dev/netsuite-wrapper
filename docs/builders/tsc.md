# TypeScript AMD (`tsc`) Setup

Use the plain `tsc` helper when the consumer build is AMD-oriented TypeScript emit with no bundler.

## Install

```bash
npm install @amerilux/netsuite-wrapper
```

The consumer project also needs TypeScript.

## What the helper does

- copies the wrapper AMD runtime into the consumer output folder
- instruments emitted AMD module functions so they run through the wrapper function-context helper
- rewrites emitted AMD `define(...)` dependencies that target supported `N/*` modules
- prepends wrapper bootstrap AMD dependencies when bootstrap is enabled

## Required compiler shape

The emitted output must be AMD so the helper can rewrite `define(...)` and `require(...)` calls.

Minimal `tsconfig.json` shape:

```json
{
  "compilerOptions": {
    "module": "amd",
    "target": "es2019",
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

## Minimal post-build script

```js
const {
    rewriteNetSuiteWrapperTscOutput,
} = require('@amerilux/netsuite-wrapper/tsc');

rewriteNetSuiteWrapperTscOutput({
    outDir: './dist',
    rootDir: './src',
});
```

Instrumentation is enabled by default for the plain `tsc` helper. Disable it only if you need rewrite-only behavior:

```js
rewriteNetSuiteWrapperTscOutput({
  outDir: './dist',
  rootDir: './src',
  instrumentation: false,
});
```

## Setup steps

1. Build TypeScript to AMD output with `tsc`.
2. Run `rewriteNetSuiteWrapperTscOutput(...)` after emit.
3. Pass the emitted folder as `outDir`.
4. Pass the source folder as `rootDir` so the helper can map source files into emitted `.js` files.

## Minimal command flow

```bash
tsc -p tsconfig.json
node scripts/rewrite-wrapper-output.js
```

## CLI alternative

The older CLI wrapper still works:

```bash
node node_modules/@amerilux/netsuite-wrapper/cli/rewrite-amd-imports.js --outDir dist --rootDir src
```

Disable instrumentation from the CLI if needed:

```bash
node node_modules/@amerilux/netsuite-wrapper/cli/rewrite-amd-imports.js --outDir dist --rootDir src --noInstrumentation
```

## Notes

The helper instruments emitted AMD JavaScript after `tsc` runs, so keep `module: "amd"` in the consumer `tsconfig.json`.

If you rely on comment-based ignore pragmas such as `@ptrk-ignore`, keep TypeScript comments in the emitted output.

## Optional wrapper config

If you need custom sink bootstrap or bootstrap modules, add `netsuite-wrapper.config.js` in the consumer project root and keep `rootDir` aligned with the emitted source tree.
That file is executed through Node's `require(...)` during the build, so only use it from trusted project code.