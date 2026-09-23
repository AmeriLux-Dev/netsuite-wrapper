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

Every wrapper module answers every member of its `N/*` module. Whatever it does not instrument (`query.Operator`, `search.createFilter`, `record.attach`, members a newer NetSuite release adds) is NetSuite's own, read on each access. This matters because the build swaps the module in every file of the bundle, including packages in `node_modules` that were never written with the wrapper in mind.

## Never in the way

The wrapper must never be the reason an application fails. Every part of it that watches a call steps aside when it fails:

- **The call runs once and comes back unchanged.** A wrapped `N/*` call, a tracked entry point and an instrumented function each run exactly once, and the caller gets exactly what they returned (the same promise, when they return one) or exactly the error they threw.
- **Telemetry failures are dropped.** A sink, span, metadata builder or scope lookup that throws, before or after the call, leaves the call untracked. A sink that cannot be created is replaced by a pass-through for the rest of the script, so its exporters are not registered again on every call.
- **Returned objects stay NetSuite's.** When NetSuite refuses the instrumented method swapped onto an object it returned (a read-only `save`, a frozen query), the object comes back as NetSuite made it.
- **Log calls always reach N/log.** If the wrapper cannot tag or split a log call, the call is written as the application made it.

The first time a script's wrapper steps aside, it writes one `netsuite-wrapper stepped aside` entry to N/log with the stage (`before`, `after`, `skipped`, `instrument`, `log`) and the message, so a broken wrapper is visible without flooding the log.

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

The bundled `performance-tracker` integration builds one span per tracked script run (the root) and one per wrapped `N/*` call inside it, and hands every run's spans and log lines to the registered **exporters** as one batch when the run ends. Enable it through `netsuite-wrapper.config.js`:

```js
module.exports = {
    telemetryBootstrap: {
        integration: 'performance-tracker',
        // Every @NScriptType entry file is tracked under this scope; a @pftr:scopeKey header tag overrides it per file.
        scopeKey: 'app:my-app',
        // Write spans to customrecord_ptrk_exec_span, the schema the PerformanceTracker NetSuite app reads. Default true.
        recordExport: true,
        // Also POST each run's spans and log lines as one JSON document to an external log system.
        httpsExport: {
            url: 'https://logs.example.com/ingest',
            secretId: 'custsecret_my_app_telemetry', // a NetSuite API secret; the token itself never appears in code or config
            // authorizationHeader: 'Authorization', authorizationScheme: 'Bearer', headers: { 'X-Tenant': 'x' }, source: 'my-app',
        },
    },
};
```

### Scope modes

A run's scope key is looked up in `customrecord_ptrk_scope` at the start of the run (cached for thirty minutes in `N/cache`). The scope's mode is the account-side switch, changed in the PerformanceTracker app without a redeploy:

- `off`: the run is not tracked. Nothing is exported, nothing is queued.
- `boundary`: the root span and the run's log lines are exported. Wrapped `N/*` calls are not persisted. This is the production setting: one record, one request per run.
- `diagnostic`: everything, including a span per wrapped `N/*` call.

A scope key with no row runs as `boundary`.

### Tracked entry points

With `scopeKey` set, every file whose header carries a supported `@NScriptType` (Restlet, Suitelet, MapReduceScript, UserEventScript) becomes a tracked script. Its exported entry functions (`export function post`, `export const onRequest = (context) => …`) run inside `runTrackedScriptEntry`, and so does an exported const initialised by a call (`export const post = defineRestlet(...)`), whose returned function is wrapped through `wrapTrackedScriptEntryFunction`.

### What a log line carries

Every wrapped `log.*` call still writes to `N/log` as before (see the tag and chunking notes below). Inside a tracked run it also becomes a structured entry for exporters that accept log entries: level, title, the details as passed (not the chunked string), timestamp, execution and flow ids, script and deployment ids, the enclosing function and module, the call chain of instrumented functions (`post -> roles -> loadUser`) and the enclosing function's **arguments**, snapshotted by parameter name.

Argument capture costs nothing until it is used: the build passes the parameter values to the function-context helper as references, and they are serialised only when a log call inside the function asks for them or when the function throws. The snapshot is bounded (strings cut at 200 characters, five array items, twenty keys, two levels, two thousand characters in all; a NetSuite record collapses to its type and id). A function that receives credentials or personal data opts out with `@ptrk-ignore-arguments` in the comment above it; the same tag at the top of a file opts out every function in that file.

An error thrown out of an instrumented function is recorded once, at the innermost function it left, with that function's arguments, in the root span's detail (`observedErrors`).

### Exporters

`recordExport` and `httpsExport` register the two bundled exporters from the generated bootstrap. A project that needs another destination, or a payload shape the `format` hook of `createHttpsExporter` cannot express through config, registers its own from a module listed in `bootstrapModules`:

```js
// telemetry-bootstrap.js, listed in netsuite-wrapper.config.js under bootstrapModules
const { registerTelemetryExporter } = require('@amerilux/netsuite-wrapper/telemetry-exporter');

registerTelemetryExporter({
    name: 'my-collector',
    acceptsLogEntries: true,
    export(batch) {
        // batch: { executionId, flowId, scopeKey, mode, spans, logs }
    },
});
```

An exporter that throws is reported to `N/log` and never stops the others or the script. When no exporter is registered at all, the record exporter is used, which is what earlier releases did.

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

With telemetry off, the build swaps only `N/log` (for chunk logging); every other `N/*` module is NetSuite's own, with nothing of the wrapper in between. A `modules` list in the config file (`modules: ['log', 'record']`) overrides that choice either way.

### Trace logging

The wrapper can emit internal `[NSW_TRACE]` diagnostics describing how each log call is routed (active execution, function context, chunking). It is **off by default**. Turn it on through `netsuite-wrapper.config.js`:

```js
module.exports = {
    traceLog: true,
};
```

When enabled, the builder injects a small bootstrap that calls `setTraceLogEnabled(true)` at runtime, so trace logging is active for the deployed script without any code change. You can also toggle it directly at runtime via `log.setTraceLogEnabled(true)` / `log.isTraceLogEnabled()` from `@amerilux/netsuite-wrapper/log`.

### Log tracker tags and the message title

Every wrapped `log.*` call records tracker context — the active execution id and function — as tags. As of this release those tags are written to the **start of the message detail** (e.g. `[exec_…] [fn:name::module] your detail`) and the **title is left untouched**. Earlier releases prefixed the title instead; consumers that parsed the tags out of the log title must read them from the detail. Short messages carry the tags inline; chunked messages repeat the tags at the start of every chunk (after the chunk marker) so each chunk stays attributable.

### Chunk logging

NetSuite truncates a log detail at ~4000 characters, so by default the wrapper splits long details into multiple entries, each prefixed with a `[[NSW_CHUNK|…]]` marker that downstream viewers use to re-assemble the original message. Some users would rather not see that marker text. The behaviour is configurable through `netsuite-wrapper.config.js`:

```js
module.exports = {
    chunkLogging: 'group', // default
};
```

- `group` (default): split long details and add the `[[NSW_CHUNK|…]]` marker so viewers can re-assemble them.
- `silent`: still split long details across entries, but omit the marker (no extra text; entries are not re-assembled).
- `off`: never split — emit the detail in a single call and let NetSuite truncate it.

For any non-`group` mode the builder injects a bootstrap that calls `setChunkLogMode('silent' | 'off')` at runtime. You can also set it directly via `log.setChunkLogMode('off')` / `log.getChunkLogMode()` from `@amerilux/netsuite-wrapper/log`.

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

## Compatibility boundary

The wrapper package is intentionally generic.

- The wrapper owns module-level operation metadata (`module`, `action`, `summary`, `detail`).
- Consumers such as PerformanceTracker own the adapter that converts wrapper events into their own telemetry model.
- Sink-side concerns (storage, scope policy, cache policy, custom-record schema) live in the adapter, not in the wrapper.

The long-term contract is the sink interface in `src/telemetry.ts`, not any specific consumer implementation.

## License

[MIT](./LICENSE)
