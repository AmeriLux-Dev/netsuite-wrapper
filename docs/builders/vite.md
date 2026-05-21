# Vite Setup

Use the Vite plugin when the consumer project builds through Vite and you want the wrapper's Rollup-based rewrite behavior.

## Install

```bash
npm install @amerilux/netsuite-wrapper
```

The consumer project also needs Vite.

## What the plugin does

- applies the wrapper's Rollup-style `N/*` rewrite behavior in Vite build mode
- injects wrapper bootstrap imports into entry files when bootstrap is enabled
- instruments source before bundling unless you explicitly disable it

## Minimal config

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

## Setup steps

1. Add `createNetSuiteWrapperVitePlugin()` to the Vite `plugins` list.
2. Set the real script entry under `build.rollupOptions.input`.
3. Keep `N/*` external under `rollupOptions.external`.
4. Build normally with Vite.

## Instrumentation

Instrumentation is enabled by default.

Disable it explicitly like this:

```js
createNetSuiteWrapperVitePlugin({
    instrumentation: false,
});
```

Or pass an object for custom include or exclude rules:

```js
createNetSuiteWrapperVitePlugin({
    instrumentation: {
        include: ['./src'],
        exclude: [/\.test\.ts$/i],
    },
});
```

## Optional wrapper config

If you need custom sink bootstrap or bootstrap modules, add `netsuite-wrapper.config.js` in the consumer project root.
That file is executed through Node's `require(...)` during the build, so only use it from trusted project code.