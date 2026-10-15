# Build and Run

The server keeps MJPEG as its browser output. AVC decoding uses the operating system decoder: VideoToolbox on macOS and Media Foundation on Windows.

## macOS

Install Go and Xcode Command Line Tools, then run:

```sh
go run .
```

## Windows

Install Go and MSYS2's UCRT64 MinGW-w64 toolchain (`gcc` and `g++`). The Windows decoder uses cgo and the system Media Foundation H.264 decoder, so a cgo-disabled build will compile only the unsupported-platform stub.

From PowerShell, build the server:

```powershell
$env:CGO_ENABLED = "1"
$env:CC = "C:\msys64\ucrt64\bin\gcc.exe"
$env:CXX = "C:\msys64\ucrt64\bin\g++.exe"
go build -o emu-stream.exe .
```

The Media Foundation H.264 transform must be available on the Windows installation. Windows N editions may need the Media Feature Pack.

## Linux

Install Go, a C compiler, `pkg-config`, and the FFmpeg development libraries for `libavcodec`, `libavutil`, and `libswscale` (for example, Debian/Ubuntu packages `libavcodec-dev libavutil-dev libswscale-dev`). Then run:

```sh
CGO_ENABLED=1 go build -o dist/control-server-linux-amd64 .
```

The Linux backend links to the system FFmpeg libraries; it does not launch the `ffmpeg` executable. The same MJPEG HTTP output is retained.

## Android Device

Run the server before launching the agent. For manual agent startup, map its
abstract socket to the server's actual agent TCP port (default `38476`):

```sh
adb reverse localabstract:screen-sharing-agent tcp:38476
```

Install JDK 17 and Android SDK platform/build-tools 36, CMake 3.22.1, and the NDK
required by the agent's Android Gradle Plugin. Run `make agent` to build the
complete APK archive under the app_process classpath JAR name. Keeping APK
metadata is required; a JAR containing only `classes.dex` is not loadable by
this agent launcher. `make plugin-bundle` builds and copies the host server,
JAR, and Android ABI libraries into the plugin's VS Code platform directory.
The server's startup path installs and launches the agent through ADB; separate
launcher scripts are not required. The plugin has a WASM Opus decoder fallback.
When `--device-serial` is provided, the server sets up ADB reverse itself,
including any fallback port selected with `--auto-port`.

See [packaging and publishing](../docs/RELEASING.md) before distributing binaries;
Linux's system FFmpeg dependency is not automatically bundled by this Makefile.

## Tests

For an optional faster JPEG encoder on Linux/Windows (also supported on macOS), install `libjpeg-turbo` development headers/libraries and `pkg-config`, then build/test with the `turbojpeg` tag:

```sh
make server GO_TAGS=turbojpeg
make test GO_TAGS=turbojpeg
```

Homebrew provides `jpeg-turbo` and `pkg-config`; Debian/Ubuntu provide `libturbojpeg0-dev` and `pkg-config`. Windows requires a matching MinGW libturbojpeg installation with a `libturbojpeg.pc` discoverable by `pkg-config`. Dynamically linked turbo builds require the library on the target host; the default macOS build uses system frameworks only.

```sh
go test -race ./...
go vet ./...
```

Run `make benchmark` for encoder microbenchmarks. From `plugin/`, `npm run test:perf`
builds and runs the separate combined CPU/RAM/FPS benchmark automatically;
`make perfprobe` builds just that utility. See [PERFORMANCE.md](PERFORMANCE.md)
for replay, dedicated-device, and browser latency scenarios.
