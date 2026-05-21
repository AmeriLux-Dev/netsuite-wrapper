# Publishing `@amerilux/netsuite-wrapper`

This package is published to **GitHub Packages** (the GitHub npm registry).

The recommended release path is the GitHub Actions tag flow. Local publishing from a developer machine is supported as a fallback.

External references:

- GitHub Packages npm docs: <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry>
- npm publish docs: <https://docs.npmjs.com/cli/v10/commands/npm-publish>

## What you are publishing

- Package name: `@amerilux/netsuite-wrapper`
- Version source: `package.json`
- Registry: `https://npm.pkg.github.com`
- Required scope-to-org mapping: the npm scope `@amerilux` maps to the GitHub org `amerilux`. The repository must live under `github.com/amerilux/netsuite-wrapper` for GitHub Packages to accept the publish under that scope.

## Recommended release flow (GitHub Actions)

1. Make your code changes.
2. Update the `version` field in `package.json`.
3. Run local checks: `npm run typecheck`, `npm run build`, `npm run pack:dry-run`.
4. Commit and push your branch.
5. Create a Git tag that matches the package version with a `v` prefix.
6. Push the tag. The publish workflow runs automatically.

Example for version `0.2.4`:

```bash
git commit -am "Release v0.2.4"
git push
git tag v0.2.4
git push origin v0.2.4
```

The workflow file at `.github/workflows/publish.yml` runs on tag pushes that match `v*.*.*`:

1. Checks out the repo.
2. Sets up Node 20 with the GitHub Packages registry.
3. Verifies the tag version matches `package.json`.
4. Installs dependencies with `npm ci`.
5. Runs `npm run typecheck` and `npm run pack:dry-run`.
6. Publishes with `npm publish` using the workflow's `GITHUB_TOKEN`.

No secrets need to be configured — `GITHUB_TOKEN` is provided automatically by Actions and has `packages: write` permission inside this workflow.

## Local publish (fallback)

Use this only when you intentionally want to publish from your machine.

### 1. Create a Personal Access Token (classic)

GitHub Packages npm publishing requires a **classic** Personal Access Token with the `write:packages` scope.

Create one at <https://github.com/settings/tokens>.

### 2. Authenticate npm against GitHub Packages

In your home directory `~/.npmrc` (do **not** commit this file):

```ini
@amerilux:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_PAT_HERE
```

Or set `NODE_AUTH_TOKEN` in your shell and use the `template.npmrc` in this repo as a starting point.

### 3. Publish

From the repo root:

```bash
npm install
npm run typecheck
npm run pack:dry-run
npm publish
```

`publishConfig` in `package.json` already points npm at `https://npm.pkg.github.com`, so no extra flag is needed.

## Tag rules

- The tag must start with `v` and match the `version` in `package.json` exactly.
- Versions cannot be republished. To re-release, bump the version and push a new tag.

## Common mistakes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Workflow does not run on tag push | Tag does not match `v*.*.*` | Retag with the correct format and push. |
| `401 Unauthorized` on local publish | PAT missing `write:packages` scope, or scope mismatch | Recreate a classic PAT with `write:packages`; confirm npm scope matches the GitHub org. |
| `409 Conflict` on publish | Version already exists | Bump `package.json` version and retag. |
| `404 Not Found` on publish | Repo is not under the `amerilux` GitHub org | Move the repo under the org that matches the npm scope. |

## Consumer install

Consumers install from GitHub Packages by adding a scope mapping to their `.npmrc` and providing a token with `read:packages` scope.

`.npmrc`:

```ini
@amerilux:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Then:

```bash
NODE_AUTH_TOKEN=ghp_yourtokenhere npm install @amerilux/netsuite-wrapper
```

For CI, set `NODE_AUTH_TOKEN` from a repo secret.

## Future: also publishing to the public npm registry

This package is currently published only to GitHub Packages. A future workflow can add a second publish step to the public npm registry (`https://registry.npmjs.org`) using an `NPM_TOKEN` secret. The package metadata and license are already compatible.

## Sources

- `package.json`
- `.github/workflows/publish.yml`
- GitHub Packages npm docs
- npm publish docs
