# Changelog

## 0.2.0 - 2026-08-16

This semver-minor release prepares `linear-sdk-axi` for broader agent-driven
project operations while preserving the existing default TOON contract.

### Added

- bounded cursor pagination with explicit `--after` and `--all --max-items`;
- project-scoped issue lists and project views with issue summaries;
- Linear Project Update list and create commands;
- issue relation removal by ID or semantic edge, plus relation and comment IDs;
- optional versioned JSON output through `--output json`;
- `--verify` read-after-write proof for issue, relation, comment, project, and
  Project Update mutations.

### Changed

- dry-run and live writes now share locally knowable validation;
- relation commands are fully idempotent for semantic add and remove paths;
- source-repository maintainers can run current source reliably with
  `node bin/run-local.mjs <args>` without losing quoted Windows arguments.

### Verification

- the local mocked and compiled-CLI suite, with Node 20 and Node 22 required in
  pull-request CI before merge;
- npm package dry-run and high-severity production dependency audit;
- authorized live dogfood through the release project itself.
