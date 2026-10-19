# Packaging and Publishing

## Identity and License

Publisher: `Vali-98`. Extension ID: `Vali-98.valdroid-emulator`.
The project uses **AGPL-3.0-only**, not an "or later" grant. Third-party material
retains its own licenses; preserve upstream notices.

AGPL permits commercial use. It does not require publishing every private edit.
Its conditions apply to covered works, including corresponding source when
conveying binaries and the modified-network-version provision in section 13.
Read [LICENSE](../LICENSE); this document is not legal advice.

Keep complete, matching corresponding source available for every binary release,
including build/install scripts, dependency versions, and notices. The packager
embeds the clean commit's repository archive and a commit-specific `SOURCE.md`.
External native libraries need their own source/notices where their terms require
them; a moving default-branch link does not identify a released binary's source.

## Build a VSIX

Use the pinned official `@vscode/vsce` installed by `npm ci` in `plugin`.
Node.js 22 or newer is required. The host server is pure Go and uses
CGO_ENABLED=0; video decoding runs in the VS Code webview through WebCodecs.
The Android agent still requires its SDK/NDK/JDK build tools.

| VS Code target | Go OS / architecture |
| --- | --- |
| darwin-arm64 | darwin/arm64 |
| darwin-x64 | darwin/amd64 |
| linux-x64 | linux/amd64 |
| linux-arm64 | linux/arm64 |
| win32-x64 | windows/amd64 |

macOS ARM64 is locally verified. Validate startup, WebCodecs AVC support,
audio, and shutdown on each target before publishing. Windows ARM64, Alpine,
and web are not packaging targets.

1. Set the version in `plugin/package.json` and update its lockfile/changelog.
2. Commit source changes. Run `make plugin-bundle` in `control-server` with the
   Android SDK/NDK/JDK installed.
3. In `plugin`, run `npm ci`, `npm test`, and `npm run test:packaging`.
4. Run `npm run vsix -- --target darwin-arm64` (replace the target as appropriate).
5. Install the VSIX from `plugin/releases` in clean VS Code and test startup,
   input, audio, file transfers, console, and shutdown.

The helper checks the server's OS/architecture, commit, and clean
build state. It requires the Android JAR and all four ABI libraries, gathers JS
license texts, includes only the chosen native bundle, preserves executable bits,
and removes temporary staging files. It does not prove native runtime portability
or that stale Android assets were rebuilt: rebuild all components for a release.

For a **local-only** dirty-tree smoke test:

```sh
npm run vsix -- --target darwin-arm64 --development
```

Do not publish `*-dev.vsix`. These omit the release source archive and carry a
development warning. A bare `vsce package` bypasses the helper's checks.

## Marketplace Upload

Publish a VSIX for each validated platform at the same version, not a universal
VSIX. Marketplace automatically selects the user's matching OS/CPU target.

For GitHub Actions, vsce 4 supports trusted publishing with `--oidc`. Configure
a Marketplace trusted publishing policy for `Vali-98`, this repository, and the
exact workflow. Grant `id-token: write` only to the publishing job. Protect its
GitHub environment with release approval. Never publish pull-request code.

After setup, publish the previously tested artifact without rebuilding it:

```sh
npx --no-install vsce publish --oidc --packagePath releases/valdroid-emulator-0.1.0-darwin-arm64.vsix
```

This runs in the configured GitHub Actions job, not a local terminal.
Entra authentication with `--azure-credential` is also supported. Avoid long-lived
global PATs: the official guide announces retirement on December 1, 2026.
Never put credentials in the repository or VSIX.

The included CI runs plugin tests, production JS builds, and Go server race
tests and vet checks. The native release
matrix, Android artifact job, protected publish job, Marketplace policy, and
clean-machine tests remain to be connected before automatic releases are enabled.
No workflow currently uploads to Marketplace.

## References

- [VS Code publishing and targets](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Official vsce trusted publishing](https://github.com/microsoft/vscode-vsce#trusted-publishing)
- [AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html)

## Donations

Both READMEs use Ko-fi's standard PNG button, linked to
[vali98](https://ko-fi.com/vali98). Keep the image HTTPS and PNG so it remains
compatible with Marketplace README requirements; do not embed widget scripts.
