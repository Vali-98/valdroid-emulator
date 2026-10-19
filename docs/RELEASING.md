# Releasing

## Commands

| Command | Purpose |
| --- | --- |
| `npm run release patch` | Bump, commit, tag, and optionally push. Also accepts `minor` or `major`. |
| `npm run build` | Local extension build for development. |
| `make` in `control-server` | Test and build the server, Android agent, and local native bundle. |
| `npm run vsix` | Package a development VSIX for the current OS and architecture. |

Run npm commands from `plugin` after `npm ci`. Run `make` before packaging.
Install the file in `plugin/releases` using **Extensions: Install from VSIX…**.
Local packages end in `-dev.vsix` and must not be published.

## Automated releases

Update the changelog and commit changes, then run `npm run release patch`.
A clean tree is required. The script bumps the manifest and lockfile, commits,
tags, and prompts before pushing to origin.

Tag CI tests the code and builds four platform packages: `win32-x64`, `linux-x64`,
`linux-arm64`, and `darwin-arm64`, plus one universal package containing all four.
It creates a GitHub Release with VSIX files, checksums, and release notes.
Intel Macs are not supported; macOS builds support Apple Silicon only.

CI uses `npm run vsix -- --release --target <platform>` for cross-compilation.
The universal package uses `npm run vsix -- --release --universal` after all
four native bundles have been assembled. For local universal packaging, omit
`--release`; all four bundles must already exist in `plugin/bundle`.
Release packaging requires a clean tree and matching native build provenance,
and embeds the source archive and license notices. Local packaging detects the
host automatically and permits uncommitted changes.

Beta tags such as `v0.2.0-beta.1` create GitHub prereleases.
Branch pushes, pull requests, and manual runs perform checks only.

Test the packaged extension on each target OS, including startup and shutdown.
CI cross-compiles native servers; it does not sign them or verify runtime behavior
on every target. Preserve matching source, licenses, and third-party terms.
