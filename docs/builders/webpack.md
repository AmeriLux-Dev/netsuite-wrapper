# Webpack Setup

Use the webpack helper when the consumer project already builds NetSuite scripts with webpack.

## Install

```bash
npm install @amerilux/netsuite-wrapper
```

The consumer project also needs webpack and its normal loader chain, such as `ts-loader` if the entries are TypeScript.

## What the helper does

- rewrites supported `N/*` imports to wrapper modules
- leaves unsupported `N/*` imports external for NetSuite runtime resolution
- prepends wrapper bootstrap modules to each entry when bootstrap is enabled
- instruments source functions before bundling unless you explicitly disable it

## Minimal config

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

## Setup steps

1. Keep your normal webpack `entry` values.
2. Wrap the final config with `applyNetSuiteWrapperWebpack(...)`.
3. Keep AMD output if the consumer is emitting NetSuite script modules.
4. Let the helper manage the wrapper replacements and externals.

## Instrumentation behavior

Instrumentation is enabled by default in `applyNetSuiteWrapperWebpack(...)`.

Disable it explicitly if you need rewrite-only behavior:

```js
module.exports = applyNetSuiteWrapperWebpack(config, {
    instrumentation: false,
});
```

The instrumentation helper still works, but it is now just a compatibility alias for the same default behavior:

```js
const {
    applyNetSuiteWrapperInstrumentationWebpack,
} = require('@amerilux/netsuite-wrapper/webpack-instrumentation');
```

## Optional wrapper config

If you need custom bootstrap behavior, add `netsuite-wrapper.config.js` in the consumer project root.
That file is executed through Node's `require(...)` during the build, so only use it from trusted project code.

Example:

```js
module.exports = {
    telemetryBootstrap: {
        integration: 'performance-tracker',
    },
};
```

Disable auto bootstrap:

```js
module.exports = {
    telemetryBootstrap: false,
};
```

Custom sink:

```js
module.exports = {
    telemetryBootstrap: {
        sinkModule: './my-wrapper-sink.js',
        sinkExport: 'createSink',
    },
};
```