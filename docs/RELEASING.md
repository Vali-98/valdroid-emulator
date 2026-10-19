# Releasing

## GitHub release

1. Update `plugin/package.json`, its lockfile, and `plugin/CHANGELOG.md`.
2. Commit the final source, then push a matching tag:

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

[CI](../.github/workflows/ci.yml) runs tests, builds the Android agent and five
platform VSIX packages, then uploads them with checksums and release notes.
Beta tags such as `v0.2.0-beta.1` create prereleases. Existing releases are not
overwritten. Branch pushes, pull requests, and manual runs only perform checks.

Targets: `win32-x64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`.
CI uses `GITHUB_TOKEN`; no personal access token is needed. It builds the agent
in a temporary copy and leaves tracked `third_party` files unchanged.

## Local VSIX test

With the native bundle already built, run from `plugin`:

```sh
npm ci
npm run vsix -- --target win32-x64 --development
```

Install the file from `plugin/releases` using **Extensions: Install from VSIX?**.
Do not publish `*-dev.vsix`. Release packaging requires a clean commit and a
matching native build; omit `--development`. Use the helper rather than bare vsce.

## Before publishing

- Test the packaged extension on each target OS, including startup and shutdown.
- Keep matching source, licenses, and runtime notices with the release. Use
  AGPL-3.0-only for project code and preserve third-party terms.
- Keep pinned toolchains aligned with the runtime notices. CI does not sign
  native binaries or verify their behavior on each target OS.

Marketplace publishing is separate and is not automated. Publish the tested
platform VSIX files at the same version using [vsce](https://github.com/microsoft/vscode-vsce#trusted-publishing).
