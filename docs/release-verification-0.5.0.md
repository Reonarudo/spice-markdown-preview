# SPICE Schematic Preview 0.5.0 verification

Release: the BOM view on every fence (`docs/bom-view-spec.md`), drawn from spice-renderer 1.1.0's rows. Publisher: ReoX86.
Source tag: `v0.5.0` (`78c84aa9d09a1a82598a9eae63dd122425875c6b`).

- GitHub release: https://github.com/Reonarudo/spice-markdown-preview/releases/tag/v0.5.0, built by `release.yml` from the tag (https://github.com/Reonarudo/spice-markdown-preview/actions/runs/42204126263): lint, build, 66 unit tests, packaging and the packaged-VSIX host test under Xvfb.
- VSIX: `spice-schematic-preview-0.5.0.vsix`, **1 378 422 bytes, 143 files** (0.4.0: 1 371 685 bytes, 142 files; the growth is the BOM table, its stylesheet and the three-view preview script).
- SHA-256: `499ccedf4ad8a0831c467cec2d33b931ef8e09fe62e990e7a8f87eb897414dd9`.
- spice-renderer 1.1.0 installed from its release tarball (`sha512-skfMv1ZD88LiNpw8NmW30D6SSpNIcCa6uwDV8zhxjihxhUmidrX9ES6s7zRie1kt4eUc+nMKFU7mVuC7L+d9aA==`).
- CI passed on Linux, Windows, macOS and the VS Code 1.101.0 minimum-version job: https://github.com/Reonarudo/spice-markdown-preview/actions/runs/42204126188
- The release asset was downloaded, checked against the release's `SHA256SUMS`, and passed `npm run test:package -- <asset>` on VS Code 1.145.2 (2026-11-06).
- `npm run test:preview` on the release commit: **17 live checks passed** on VS Code 1.145.2 (2026-11-06), the required line for the first release carrying the BOM view (spec 11.8).
- The manual checklist (spec 11.7: three styles × light, dark and high contrast, the three-button row in source view, both buttons in the RTL container, focus rings, scroll sync in each view, the `plain` wide table, the `card` summary in RTL) was done on `examples/bom-view.md` in a development window and accepted by the user on 2026-11-06.

## Marketplace

Published on 2026-11-06 with `npx vsce publish --packagePath <release asset>`, so the Marketplace and GitHub carry the same bytes:
https://marketplace.visualstudio.com/items?itemName=ReoX86.spice-schematic-preview

- Listing: 0.5.0 has engine `^1.101.0`.
- Installed by ID (`ReoX86.spice-schematic-preview@0.5.0`) into an isolated temporary profile with VS Code 1.139.0's CLI. The installed files equal the release asset; `package.json` differs only by the `__metadata` the installer adds, and `.vsixmanifest` is the asset's `extension.vsixmanifest`.

The normal profile was not modified.
