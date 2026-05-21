# Builder Setup Docs

This folder contains builder-specific setup guides for `@amerilux/netsuite-wrapper`.

- [Webpack](./webpack.md)
- [Rollup](./rollup.md)
- [Vite](./vite.md)
- [TypeScript AMD (`tsc`)](./tsc.md)

Common pattern across all builders:

1. Install `@amerilux/netsuite-wrapper` in the consumer project.
2. Keep normal `N/*` imports in source files.
3. Add the wrapper integration in the build config.
4. Build normally.
5. Add `netsuite-wrapper.config.js` only if you need custom sink bootstrap or extra bootstrap modules.

`netsuite-wrapper.config.js` is executed through Node's `require(...)` during the build, so only use it from trusted project code.