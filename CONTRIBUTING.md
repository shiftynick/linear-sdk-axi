# Contributing and release operations

This is the fresh-session runbook for maintainers and coding agents. Keep it
small, current, and grounded in the repository rather than relying on chat
history.

## Start here

1. Read `README.md` for the product surface and `skills/linear-sdk-axi/SKILL.md`
   for Linear's issue-first operating model.
2. Inspect `git status --short --branch`, open pull requests, and the current
   npm version before changing anything.
3. Install and validate with:

   ```powershell
   npm ci
   node bin/run-local.mjs --version
   npm test
   npm pack --dry-run
   ```

`npm test` includes mocked and compiled-CLI coverage. The two live Linear
checks are intentionally opt-in (`LINEAR_SDK_AXI_LIVE_TEST=1`) and read-only.
Run them only with a credential supplied through a secret store or temporary
shell environment; never commit `.env` or print tokens.

Use `node bin/run-local.mjs <args>` for repository-local dogfood. It rebuilds,
preserves quoted arguments on Windows, and avoids
`npm exec --package=linear-sdk-axi@<version>` being shadowed by the checkout's
package identity.

## Day-to-day changes

- Branch from current `main` as `agent/<short-description>`.
- Keep each pull request focused. Preserve user changes outside the requested
  scope, and stage explicit paths rather than `git add -A` in a mixed tree.
- Run `npm test`, `npm pack --dry-run`, and `git diff --check` before pushing.
  `npm audit --omit=dev --audit-level=high` is the release security check.
- Open a PR against `main`. The GitHub CI matrix must pass on Node 20 and 22.
- Merge to `main` with squash merge (the repository policy does not permit
  rebase merges into `main`), then verify the post-merge CI before deleting the
  merged branch locally and remotely.

## Versioning and npm releases

Package versions are immutable once published. Use a new semantic version for
every release and keep these three values synchronized:

- `package.json` and the root package entry in `package-lock.json`
- `src/version.ts`
- the compiled CLI assertion in `test/e2e.test.ts`

The end-to-end test intentionally compares `linear-sdk-axi --version` with
`package.json`; it prevents the CLI and registry version from drifting apart.

Release only after the change PR and its post-merge CI are green:

1. Confirm the target does not already exist:

   ```powershell
   npm view linear-sdk-axi@<version> version --json
   ```

2. In GitHub Actions, run **Publish npm package** from `main`.
3. Verify the registry and installed command from outside this repository:

   ```powershell
   npm view linear-sdk-axi version dist-tags.latest --json
   npx --yes linear-sdk-axi@<version> --version
   ```

The publish workflow uses npm Trusted Publishing through GitHub OIDC. Do not
add `NPM_TOKEN` or disable 2FA. It reruns tests before publishing and produces
provenance automatically.

## GitHub releases and tags

npm publication does not create a GitHub Release. After npm verifies the
version, create a matching `v<version>` tag and GitHub Release at the exact
source commit that npm recorded:

```powershell
npm view linear-sdk-axi@<version> gitHead --json
gh release create v<version> --target <gitHead> --title "v<version>" --generate-notes
```

Use the `gitHead` from npm metadata, not a guessed current branch tip. The
GitHub Releases page is the public changelog/index; npm remains the package
distribution source.

## Authentication and live verification

- Prefer `LINEAR_API_KEY` only for noninteractive automation and testing.
- Test interactive user access with `auth login --client-id <client-id>` using
  Authorization Code + PKCE. API keys take precedence, so clear that
  environment variable when proving OAuth.
- Use `doctor`, `me`, and `team list` for safe read-only validation before any
  write command.
- Load or install `skills/linear-sdk-axi/SKILL.md` for any agent that will make
  Linear decisions. It explains when issues, projects, cycles, labels, and
  relations are appropriate.
