# Development

## Build and test

Requires Node.js 22+, Go, and Android build tools for native bundles.

```sh
cd plugin
npm ci
npm run compile
npm test
npm run test:packaging
```

Use `npm run watch` while editing and reload the Extension Development Host.
Run `make test` in `control-server` for Go race tests and vet.
See [releasing](RELEASING.md) for native bundles and VSIX packaging.

## Layout

- `plugin/src/host`: device discovery, processes, transfers, and VS Code views.
- `plugin/src/webviews`: emulator and console UI.
- `plugin/src/shared`: host/webview contracts.
- `control-server/internal`: agent startup, media forwarding, input, and device APIs.

Tests live in `plugin/tests` and beside Go packages. Do not modify `third_party`.

## AVC playback

Android agent -> Go server -> `/avc` WebSocket -> WebCodecs -> canvas.
Decode every reference frame; present only the newest decoded frame. Keep queues
bounded and release sockets, decoders, frames, and input gestures on teardown.

The [server](../control-server/internal/server/video_avc.go) defines the wire
format: JSON configuration, then a 32-byte header followed by Annex-B NAL units.

For live profiling, start the server and emulator, install Playwright Chromium,
then run from `plugin`:

```sh
npm run profile -- http://127.0.0.1:38475 30
```

Requires ADB, Chrome, and Settings on `emulator-5554`. The script switches apps
and writes performance results to the system temp directory. Frame age excludes
device capture/encoding; CPU measures only the Go server.
