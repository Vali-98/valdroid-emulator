# Valdroid Emulator

Stream and control Android emulators inside VS Code, with audio, device controls,
drag-and-drop APK installation and file transfers to Downloads, and a synchronized
ADB/logcat console.

Supported platforms: **Windows x64**, **Linux x64/ARM64**, and **macOS on Apple Silicon**.
Intel Macs and Windows ARM64 are not supported.

- [Features and setup](plugin/README.md)
- [Development and architecture](docs/DEVELOPMENT.md)
- [Server builds](control-server/README.md#building-the-host-server)
- [Packaging and publishing](docs/RELEASING.md)
- [AVC playback and profiling](docs/DEVELOPMENT.md#avc-playback)
- [Contributing](CONTRIBUTING.md)

## Build Locally

Install Node.js 22 or newer, Go, and the Android SDK
and JDK described in the server build guide. In `control-server`, run
`make`. In `plugin`, run `npm ci`, then `npm run build`
and launch the Extension Development Host.

Bundles use VS Code platform names such as `darwin-arm64`,
`win32-x64`, and `linux-x64`.

## License

Valdroid's original code is **AGPL-3.0-only**, without warranty.
See [LICENSE](LICENSE) and [NOTICE](NOTICE). Dependencies and the vendored Android
agent retain their upstream licenses. Contributions use the same project license.

## Support

Issues and pull requests are welcome. You can also support development on Ko-fi.

<a href="https://ko-fi.com/vali98"><img src="https://storage.ko-fi.com/cdn/kofi5.png?v=6" alt="Support me on Ko-fi" height="36"></a>
