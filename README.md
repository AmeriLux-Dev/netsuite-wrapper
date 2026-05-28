# @amerilux/netsuite-wrapper

Instrumented wrappers around high-value NetSuite SuiteScript modules.

Instead of importing directly from `N/record`, `N/query`, or `N/search`, your project imports the wrapper modules and binds a telemetry sink once per script boundary. The wrapper produces structured events for every wrapped operation; you decide what to do with them.

The package ships build-tool integrations for **webpack**, **Rollup**, **Vite**, and plain **`tsc`** AMD emit so the rewrite from `N/*` to wrapper modules happens automatically at build time — your source code keeps using normal `N/*` imports.

## Why

SuiteScript's native `N/*` modules give you no visibility into how long calls take, how often they run, or which scripts triggered them. This package wraps high-traffic entry points (record load/save, query/search execution, outbound HTTPS, task lifecycle, etc.) and emits a structured event for each call. Plug those events into your own telemetry pipeline — or use the bundled `performance-tracker` integration that writes to the `customrecord_ptrk_exec_span` custom record schema.

The wrapper is intentionally generic: it owns the event shape, you own the sink.

## Install

```bash
npm install @amerilux/netsuite-wrapper
```

## Wrapped modules

Each wrapper is a drop-in replacement for the corresponding `N/*` module — the public API matches the SuiteScript surface; instrumentation is layered underneath.

| Wrapper entry | Replaces | Instruments |
| --- | --- | --- |
| `@amerilux/netsuite-wrapper/record` | `N/record` | load, save, create, delete, transform, copy, submitFields, attach, detach |
| `@amerilux/netsuite-wrapper/query` | `N/query` | run, runPaged, runSuiteQL, runSuiteQLPaged |
| `@amerilux/netsuite-wrapper/search` | `N/search` | create, load, lookupFields, run, runPaged, global search |
| `@amerilux/netsuite-wrapper/https` | `N/https` | get, post, put, delete, request, requestRestlet, requestSuitelet, requestSuiteTalkRest |
| `@amerilux/netsuite-wrapper/url` | `N/url` | format, resolveDomain, resolveRecord, resolveScript, resolveTaskLink |
| `@amerilux/netsuite-wrapper/runtime` | `N/runtime` | getCurrentScript, getCurrentSession, getCurrentUser, isFeatureInEffect |
| `@amerilux/netsuite-wrapper/task` | `N/task` | create, submit, addInboundDependency, checkStatus |
| `@amerilux/netsuite-wrapper/log` | `N/log` | audit, debug, error, emergency |

`https` and `url` are true wrappers (not pass-throughs) — they re-export the rest of the SuiteScript surface unchanged.

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

The package does not force a telemetry backend. It exposes a sink contract (see `src/telemetry.ts`) so projects can plug in their own implementation, or use the bundled `performance-tracker` integration.

## Build integration

Source code keeps using normal `N/*` imports. The build helpers rewrite supported `N/*` imports to wrapper modules and leave the rest external for NetSuite's runtime to resolve.

Pick the guide for your builder:

- [Webpack setup](./docs/builders/webpack.md)
- [Rollup setup](./docs/builders/rollup.md)
- [Vite setup](./docs/builders/vite.md)
- [TypeScript AMD (`tsc`) setup](./docs/builders/tsc.md)

Each guide covers install, minimal config, instrumentation defaults, and the optional `netsuite-wrapper.config.js` file used for custom sink bootstrap.

### Quick reference

| Builder | Integration call | What you do |
| --- | --- | --- |
| Webpack | `applyNetSuiteWrapperWebpack(config)` | Wrap your final webpack config. |
| Rollup | `createNetSuiteWrapperRollupPlugin()` | Add to `plugins`, keep `N/*` external. |
| Vite | `createNetSuiteWrapperVitePlugin()` | Add to `plugins`, set entry under `build.rollupOptions.input`. |
| `tsc` | `rewriteNetSuiteWrapperTscOutput({ outDir, rootDir })` | Emit AMD first, then run the helper. |

> `netsuite-wrapper.config.js` is loaded through Node's `require(...)` during the build. Treat it as trusted project code.

## Telemetry sink

The wrapper's contract is the sink interface in `src/telemetry.ts`. A sink receives structured events with module-level operation metadata (`module`, `action`, `summary`, optional `detail`) and decides what to persist or forward.

The bundled `performance-tracker` integration writes spans to the `customrecord_ptrk_exec_span` custom record schema, which is the format that the standalone PerformanceTracker NetSuite app consumes. Enable it through `netsuite-wrapper.config.js`:

```js
module.exports = {
    telemetryBootstrap: {
        integration: 'performance-tracker',
    },
};
```

Or plug in a custom sink:

```js
module.exports = {
    telemetryBootstrap: {
        sinkModule: './my-wrapper-sink.js',
        sinkExport: 'createSink',
    },
};
```

Disable bootstrap entirely:

```js
module.exports = {
    telemetryBootstrap: false,
};
```

## Local consumer test flow

You can test the package from a consumer project with a local file dependency before publishing:

```json
"@amerilux/netsuite-wrapper": "file:../netsuite-wrapper"
```

Then install and build the consumer normally. This validates that:

- the package export surface resolves from a consumer project
- the build helpers redirect supported `N/*` imports into the wrapper package
- the wrapper package leaves its own internal `N/*` imports external for NetSuite runtime resolution

When ready to move off the local test, replace the `file:` dependency with the published npm version.

## Releasing (maintainers)

Releases publish to the public npm registry via GitHub Actions on a tag push. Authentication uses npm Trusted Publishing (OIDC) — no `NPM_TOKEN` secret is stored.

To cut a release:

1. Bump `version` in `package.json`.
2. Run `npm run typecheck` and `npm run pack:dry-run` locally.
3. Commit and push.
4. Tag with `v<version>` and push the tag.

The workflow in [.github/workflows/publish.yml](./.github/workflows/publish.yml) verifies the tag matches `package.json`, then runs `npm publish` with provenance.

First-time setup (one time only):

1. Publish manually once with `npm login` + `npm publish` so the package exists on npmjs.org.
2. On npmjs.com, open the package settings → **Trusted Publisher** → add a GitHub Actions publisher:
   - Organization: `AmeriLux-Dev`
   - Repository: `netsuite-wrapper`
   - Workflow filename: `publish.yml`

After that, every `v*.*.*` tag publishes automatically.

## Compatibility boundary

The wrapper package is intentionally generic.

- The wrapper owns module-level operation metadata (`module`, `action`, `summary`, `detail`).
- Consumers such as PerformanceTracker own the adapter that converts wrapper events into their own telemetry model.
- Sink-side concerns (storage, scope policy, cache policy, custom-record schema) live in the adapter, not in the wrapper.

The long-term contract is the sink interface in `src/telemetry.ts`, not any specific consumer implementation.

## License

[MIT](./LICENSE)
