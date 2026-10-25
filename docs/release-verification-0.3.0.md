# Release verification — SPICE Schematic Preview 0.3.0

Verified 2026-10-25. Extension ID `ReoX86.spice-schematic-preview`.

## What was released

- Migration commit `55f5d24`: schematics are drawn by spice-renderer 1.0.0
  (`https://github.com/Reonarudo/spice-renderer/releases/download/v1.0.0/reonarudo-spice-renderer-1.0.0.tgz`,
  lockfile integrity equal to the release's), shipped under the VSIX's `node_modules`.
- CI green on `55f5d24` on Linux, Windows, macOS and the VS Code 1.101.0 job
  ([run](https://github.com/Reonarudo/spice-markdown-preview/actions/runs/40185789829)).
- Tag `v0.3.0` → `release.yml` published the
  [GitHub Release](https://github.com/Reonarudo/spice-markdown-preview/releases/tag/v0.3.0)
  with the VSIX and `SHA256SUMS`
  ([run](https://github.com/Reonarudo/spice-markdown-preview/actions/runs/40208795389)).

## The release asset

- `spice-schematic-preview-0.3.0.vsix`: **1 367 289 bytes, 141 files**, SHA-256
  `295680562c552cec5ef91edda80f11bb87c78ab2152b31223b6dfb4403ca4583` (matches `SHA256SUMS`). 0.2.0 was 1 211 007 bytes.
- `npm run test:package -- <asset>` (layout checks, then the real-host test): **PASS** on
  VS Code 1.143.0 and 1.101.0.
- Published unchanged with `npx vsce publish --packagePath <asset>`, so the Marketplace and
  GitHub carry the same bytes.

## Marketplace

- Listing: 0.3.0 has engine `^1.101.0`; 0.2.0 and 0.1.0 keep `^1.95.0`.
- Install by ID into an isolated `--extensions-dir` with VS Code 1.143.0's CLI: 0.3.0; every
  file equals the release asset's, and `package.json` differs only by the added `__metadata`.
- `scripts/test-extension.mjs` with `SPICE_EXTENSION_PATH` set to the installed copy:
  **PASS** on VS Code 1.143.0 and 1.101.0.
- VS Code 1.95.0 installing by ID gets 0.2.0.
