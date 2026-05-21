# netsuite-wrapper

`netsuite-wrapper` is a reusable package for explicit, instrumented imports of NetSuite modules.

Instead of importing directly from `N/record`, `N/query`, or `N/search`, a consumer project imports the wrapper package and binds a telemetry sink once per script boundary.

## Current modules

- `@amerilux/netsuite-wrapper/https`
- `@amerilux/netsuite-wrapper/record`
- `@amerilux/netsuite-wrapper/query`
- `@amerilux/netsuite-wrapper/runtime`
- `@amerilux/netsuite-wrapper/search`
- `@amerilux/netsuite-wrapper/task`
- `@amerilux/netsuite-wrapper/log`
- `@amerilux/netsuite-wrapper/url`

`https` is a real wrapper module, not a pass-through. It instruments outbound request entry points such as `get`, `post`, `put`, `delete`, `request`, `requestRestlet`, `requestSuitelet`, and `requestSuiteTalkRest` while re-exporting the rest of the `N/https` surface.

`url` instruments URL construction entry points such as `format`, `resolveDomain`, `resolveRecord`, `resolveScript`, and `resolveTaskLink`.

`runtime` instruments context lookup entry points such as `getCurrentScript`, `getCurrentSession`, `getCurrentUser`, and `isFeatureInEffect`.

`task` instruments task lifecycle entry points such as `create`, `submit`, `addInboundDependency`, and `checkStatus`.

## Usage shape

```ts
import * as record from '@amerilux/netsuite-wrapper/record';
import { withWrapperTelemetrySink } from '@amerilux/netsuite-wrapper';

withWrapperTelemetrySink(mySink, () => {
    const salesOrder = record.load({
        type: record.Type.SALES_ORDER,
        id: 123,
    });
});
```

The wrapper package does not force a telemetry backend. It exposes a sink contract so projects such as `PerformanceTracker` can plug in their own tracking implementation.

## Build integration

The package now exposes build helpers for webpack, Rollup, Vite, and plain `tsc` AMD output. All of them handle the same two core concerns:

- redirect supported `N/*` imports into the wrapper package or copied runtime
- leave all other `N/*` imports external for NetSuite runtime resolution

The exact setup differs by builder, but the high-level pattern is always the same:

1. install `@amerilux/netsuite-wrapper` in the consumer project
2. keep importing NetSuite modules in source code with normal `N/*` imports
3. add the wrapper's builder integration in the consumer build config
4. build normally through that builder

If you want wrapper sink bootstrap or custom bootstrap modules, place a `netsuite-wrapper.config.js` file in the consumer project's build root.
That file is loaded with Node's `require(...)` during the build, so only use it from trusted project code.

Example:

```js
module.exports = {
    telemetryBootstrap: {
        integration: 'performance-tracker',
    },
};
```

### Webpack

Use the webpack helper when the consumer project already builds NetSuite scripts with webpack.

#### What to install

The consumer project needs:

- `@amerilux/netsuite-wrapper`
- `webpack`

#### What to change

1. keep your existing webpack `entry`, `output`, and project plugins
2. wrap the final config with `applyNetSuiteWrapperWebpack(...)` so wrapper rewrites, bootstrap, and instrumentation are applied by default
3. keep `N/*` imports external unless the wrapper helper overrides them

For webpack consumers, the package exports both halves of the NetSuite-module override setup:

```js
const {
    applyNetSuiteWrapperWebpack,
} = require('@amerilux/netsuite-wrapper/webpack');

module.exports = applyNetSuiteWrapperWebpack({
    entry: entries,
    plugins: [
        myProjectPlugin,
    ],
    externals: [
        myOtherExternal,
    ],
});
```

Minimal example:

```js
const path = require('path');
const {
    applyNetSuiteWrapperWebpack,
} = require('@amerilux/netsuite-wrapper/webpack');

module.exports = applyNetSuiteWrapperWebpack({
    entry: {
        index: './src/index.ts',
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'amd',
        clean: false,
    },
    module: {
        rules: [
            {
                test: /\.ts$/i,
                exclude: [/node_modules/, /\.d\.ts$/i],
                use: ['ts-loader'],
            },
        ],
    },
});
```

#### Instrumentation behavior

`applyNetSuiteWrapperWebpack(...)` now instruments by default. Opt out explicitly only if you want rewrite-only behavior:

```js
module.exports = applyNetSuiteWrapperWebpack(config, {
    instrumentation: false,
});
```

`@amerilux/netsuite-wrapper/webpack-instrumentation` still works, but it now resolves to the same default behavior for compatibility.

By default, the webpack helper enables the built-in `performance-tracker` sink and also looks for `netsuite-wrapper.config.js` in the consumer build directory when you need to override that behavior.

Opt out example:

```js
module.exports = {
    telemetryBootstrap: false,
};
```

Custom sink example:

```js
module.exports = {
    telemetryBootstrap: {
        sinkModule: './my-wrapper-sink.js',
        sinkExport: 'createSink',
    },
};
```

That keeps the wrapper-specific context and path logic inside the package instead of duplicating it in each consumer config. In the common case, the consumer only needs the helper and script-level annotations such as `@pftr:scopeKey ...`.

When `integration: 'performance-tracker'` is used, the wrapper package writes the same `customrecord_ptrk_exec_span` telemetry records that the `PerformanceTracker` app reads, so consuming apps do not need to implement their own wrapper sink module.

For the built-in `performance-tracker` integration, scope ownership lives on the script entry annotations such as `@pftr:scopeKey ...`. The build config only enables the wrapper sink bootstrap and module overrides.

### Rollup

Use the Rollup plugin when the consumer project builds entry files with Rollup directly.

#### What to install

The consumer project needs:

- `@amerilux/netsuite-wrapper`
- `rollup`

#### What to change

1. add `createNetSuiteWrapperRollupPlugin()` to `plugins`
2. keep `N/*` modules external in Rollup
3. point `input` at your NetSuite script entry files

Rollup consumers can use the plugin export directly:

```js
const {
    createNetSuiteWrapperRollupPlugin,
} = require('@amerilux/netsuite-wrapper/rollup');

module.exports = {
    input: {
        entry: './src/entry.ts',
    },
    external(id) {
        return /^N\//.test(id);
    },
    plugins: [
        createNetSuiteWrapperRollupPlugin(),
    ],
};
```

Minimal example:

```js
const {
    createNetSuiteWrapperRollupPlugin,
} = require('@amerilux/netsuite-wrapper/rollup');

module.exports = {
    input: {
        entry: './src/index.ts',
    },
    external(id) {
        return /^N\//.test(id);
    },
    output: {
        dir: 'dist',
        format: 'amd',
        entryFileNames: '[name].js',
    },
    plugins: [
        createNetSuiteWrapperRollupPlugin(),
    ],
};
```

Function instrumentation is enabled by default before bundling. Opt out explicitly if needed:

```js
createNetSuiteWrapperRollupPlugin({
    instrumentation: false,
});
```

You can also pass an object if you need custom include or exclude matching:

```js
createNetSuiteWrapperRollupPlugin({
    instrumentation: {
        include: ['./src'],
        exclude: [/\.test\.ts$/i],
    },
});
```

### Vite

Use the Vite plugin when the consumer project builds through Vite and you want the same module-rewrite behavior as the Rollup plugin.

#### What to install

The consumer project needs:

- `@amerilux/netsuite-wrapper`
- `vite`

#### What to change

1. add `createNetSuiteWrapperVitePlugin()` to the Vite `plugins` list
2. set the real entry file under `build.rollupOptions.input`
3. keep NetSuite-targeted build output configured through Vite or Rollup options

Vite build consumers can use the Vite wrapper around the Rollup plugin:

```ts
import { defineConfig } from 'vite';
const {
    createNetSuiteWrapperVitePlugin,
} = require('@amerilux/netsuite-wrapper/vite');

export default defineConfig({
    build: {
        rollupOptions: {
            input: './src/entry.ts',
        },
    },
    plugins: [
        createNetSuiteWrapperVitePlugin(),
    ],
});
```

Minimal example:

```ts
import { defineConfig } from 'vite';
const {
    createNetSuiteWrapperVitePlugin,
} = require('@amerilux/netsuite-wrapper/vite');

export default defineConfig({
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: './src/index.ts',
            output: {
                format: 'amd',
                entryFileNames: '[name].js',
            },
            external(id) {
                return /^N\//.test(id);
            },
        },
    },
    plugins: [
        createNetSuiteWrapperVitePlugin(),
    ],
});
```

Instrumentation is enabled by default. Disable it explicitly with the same option shape used by the Rollup helper:

```js
createNetSuiteWrapperVitePlugin({
    instrumentation: false,
});
```

### Plain `tsc`

Use the plain `tsc` helper when the consumer build is AMD-oriented TypeScript emit with no bundler.

#### What to install

The consumer project needs:

- `@amerilux/netsuite-wrapper`
- `typescript`

#### What to change

1. compile TypeScript to AMD output normally with `tsc`
2. run `rewriteNetSuiteWrapperTscOutput(...)` after emit so the helper can instrument emitted AMD functions and rewrite wrapper dependencies
3. point `outDir` at the emitted AMD folder
4. pass `rootDir` so the helper can map source files into emitted `.js` output

For plain `tsc` AMD output, run the package helper after emit so the generated NetSuite scripts point at the copied wrapper runtime:

```js
const {
    rewriteNetSuiteWrapperTscOutput,
} = require('@amerilux/netsuite-wrapper/tsc');

rewriteNetSuiteWrapperTscOutput({
    outDir: './dist',
    rootDir: './src',
});
```

Instrumentation is enabled by default. Disable it only if you want rewrite-only behavior:

```js
rewriteNetSuiteWrapperTscOutput({
    outDir: './dist',
    rootDir: './src',
    instrumentation: false,
});
```

Minimal example `tsconfig.json` shape:

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

Minimal post-build script example:

```js
const { rewriteNetSuiteWrapperTscOutput } = require('@amerilux/netsuite-wrapper/tsc');

rewriteNetSuiteWrapperTscOutput({
        outDir: './dist',
        rootDir: './src',
});
```

Minimal command flow:

```bash
tsc -p tsconfig.json
node scripts/rewrite-wrapper-output.js
```

The existing CLI wrapper still works:

```bash
node node_modules/@amerilux/netsuite-wrapper/cli/rewrite-amd-imports.js --outDir dist --rootDir src
```

Disable instrumentation from the CLI if needed:

```bash
node node_modules/@amerilux/netsuite-wrapper/cli/rewrite-amd-imports.js --outDir dist --rootDir src --noInstrumentation
```

The plain `tsc` helper is AMD-focused because it instruments emitted AMD module functions, rewrites emitted `define(...)` output, and copies the package AMD runtime into the build output. If you use custom `telemetryBootstrap` or custom `bootstrapModules`, pass a matching `rootDir` so the helper can map those source files into emitted `.js` output.

If you rely on comment-based ignore pragmas such as `@ptrk-ignore`, keep TypeScript comments in the emitted output.

## Builder checklist

Use this quick checklist when wiring a consumer project:

- Webpack: wrap the final webpack config with `applyNetSuiteWrapperWebpack(...)`
- Rollup: add `createNetSuiteWrapperRollupPlugin()` and keep `N/*` external
- Vite: add `createNetSuiteWrapperVitePlugin()` and configure build input under `rollupOptions`
- Plain `tsc`: emit AMD first, then run `rewriteNetSuiteWrapperTscOutput(...)`
- Any builder: add `netsuite-wrapper.config.js` only if you need custom bootstrap or sink configuration
- Treat `netsuite-wrapper.config.js` as trusted build code because the wrapper loads it with `require(...)`

## Build output

The wrapper compiles into a standard package output folder:

- `dist`

That keeps the published package output separate from source files while still allowing the package to ship compiled runtime files.

## Installing as a consumer

`@amerilux/netsuite-wrapper` is published to **GitHub Packages**. To install it, your project needs an `.npmrc` that maps the `@amerilux` scope to the GitHub Packages registry, plus a token with `read:packages` permission.

Add a `.npmrc` to your project (or to your home directory):

```ini
@amerilux:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Then install with the token in your environment:

```bash
NODE_AUTH_TOKEN=ghp_yourtoken npm install @amerilux/netsuite-wrapper
```

For CI, expose `NODE_AUTH_TOKEN` from a repo secret. In GitHub Actions, the workflow's built-in `GITHUB_TOKEN` already has `read:packages` and works directly.

A starter `.npmrc` is included as [`template.npmrc`](./template.npmrc).

## Publishing

This repo publishes via GitHub Actions when you push a `v*.*.*` Git tag. See [PUBLISHING.md](./PUBLISHING.md) for the full release flow, tag rules, and local-publish fallback.

The high-level flow is:

1. Bump the `version` in `package.json`.
2. Run `npm run typecheck` and `npm run pack:dry-run`.
3. Commit, push, then push a matching `v<version>` tag.
4. The publish workflow in `.github/workflows/publish.yml` builds, validates, and publishes to GitHub Packages.

## Local consumer test flow

You can test the package from a consumer project with a local file dependency before publishing:

```json
"@amerilux/netsuite-wrapper": "file:../netsuite-wrapper"
```

Then install and build the consumer normally. This validates four things together:

- the package export surface resolves from a consumer project
- the build helpers redirect supported `N/*` imports into the wrapper package
- the wrapper package still leaves its own internal `N/*` imports external for NetSuite runtime resolution
- the non-webpack helpers can be used from consumer build tooling without webpack-specific APIs

When you are ready to move off the local test, replace the `file:` dependency with the published GitHub Packages version.

## Compatibility boundary

The wrapper package is intentionally generic.

- The wrapper owns module-level operation metadata such as `module`, `action`, `summary`, and optional `detail`.
- A consumer such as `PerformanceTracker` owns the adapter that converts wrapper events into its own telemetry model.
- If `PerformanceTracker` changes how it stores spans, scope policy, cache policy, or custom-record schema, those changes should stay in the adapter layer, not in `netsuite-wrapper`.

That means the long-term contract is the sink interface in `src/telemetry.ts`, not any `PerformanceTracker` implementation detail.