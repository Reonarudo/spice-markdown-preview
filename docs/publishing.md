# Publishing

Release identity: `ReoX86.spice-schematic-preview`. Repository owner: `Reonarudo`.

1. Run CI checks, package, and `npm run test:package`. Install the VSIX in VS Code and inspect the built-in Markdown Preview against `examples/verification.md`.
2. Push the matching version tag (currently `v0.3.0`). The release workflow repeats checks, tests the packaged extension, and attaches its VSIX and SHA-256 digest to the GitHub Release.
3. Download that release asset, check it against the release's `SHA256SUMS`, run `npm run test:package -- /path/to/asset.vsix`, and install it in VS Code. Publish **that same file** with `npx vsce publish --packagePath <asset>` (check the stored token with `npx vsce verify-pat ReoX86`), or through the direct upload flow below if the token fails. Never publish a separately built VSIX: zips are not byte-reproducible.
4. Verify Marketplace version, metadata, and installation by extension ID, then repeat the preview check.

## Authentication

Microsoft currently recommends Microsoft Entra ID with workload identity federation. Configuring this requires publisher membership and user-owned Azure resources; this repository does not provision them or embed long-lived credentials in GitHub Actions. The GitHub release pipeline is complete independently of Marketplace authentication.

For an interactive release, Microsoft's documented PAT path remains available as of 2026-09-16: Azure DevOps → User settings → Personal access tokens → New Token → All accessible organizations → Marketplace: Manage. Use a short expiration and enter it only at `npx vsce login ReoX86`'s hidden local prompt. Never paste tokens into chat or commit them.

**Azure DevOps global PATs retire December 1, 2026.** The direct upload flow does not depend on a PAT. If automated Marketplace publishing is added later, use an explicitly authorized personal Entra publishing identity; never use the university tenant. Add that identity to the Marketplace publisher with the Contributor role, then use `vsce publish --azure-credential`. No PAT-dependent automatic Marketplace workflow is configured here.

References: [Microsoft publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [publisher management](https://marketplace.visualstudio.com/manage/publishers/).

## Direct upload without an Azure DevOps PAT

Microsoft also supports uploading the exact tested VSIX at the Marketplace publisher management page: select **ReoX86**, choose the existing extension’s **More Actions → Update**, select the release asset, and upload it. Sign-in can redirect through Microsoft's `app.vssps.visualstudio.com` identity service. Use the Microsoft account authorized for this publisher.

This project uses the personal Microsoft account publishing path, as the gnuplot, graphviz, pikchr and SMILES previews do. Do not use the university directory, its credentials, resources, or service connections for this project.
