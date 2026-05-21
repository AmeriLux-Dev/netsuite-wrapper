# Rollup Setup

Use the Rollup plugin when the consumer project builds entry files directly with Rollup.

## Install

```bash
npm install @amerilux/netsuite-wrapper
```

The consumer project also needs Rollup and any normal TypeScript plugins it already uses.

## What the plugin does

- rewrites supported `N/*` imports to wrapper modules
- leaves unsupported `N/*` imports external
- injects wrapper bootstrap imports into entry files when bootstrap is enabled
- instruments source before bundling unless you explicitly disable it

## Minimal config

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

## Setup steps

1. Point `input` at the real script entry files.
2. Mark `N/*` modules as external.
3. Add `createNetSuiteWrapperRollupPlugin()` to the plugin list.
4. Keep normal output settings for the consumer project.

## Instrumentation

Instrumentation is enabled by default.

Disable it explicitly like this:

```js
createNetSuiteWrapperRollupPlugin({
    instrumentation: false,
});
```

Custom instrumentation filters:

```js
createNetSuiteWrapperRollupPlugin({
    instrumentation: {
        include: ['./src'],
        exclude: [/\.test\.ts$/i],
    },
});
```

## Optional wrapper config

If you need custom sink bootstrap or bootstrap modules, add `netsuite-wrapper.config.js` in the consumer project root.
That file is executed through Node's `require(...)` during the build, so only use it from trusted project code.