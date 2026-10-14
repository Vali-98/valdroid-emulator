# Build and Run

The server keeps MJPEG as its browser output. AVC decoding uses the operating system decoder: VideoToolbox on macOS and Media Foundation on Windows.

## macOS

Install Go and Xcode Command Line Tools, then run:

```sh
go run .
```

## Windows

Install Go and MSYS2's UCRT64 MinGW-w64 toolchain (`gcc` and `g++`). The Windows decoder uses cgo and the system Media Foundation H.264 decoder, so a cgo-disabled build will compile only the unsupported-platform stub.

From PowerShell, run:

```powershell
.\run_windows.ps1
```

To build without starting the server:

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
./build_linux.sh
```

The Linux backend links to the system FFmpeg libraries; it does not launch the `ffmpeg` executable. The same MJPEG HTTP output is retained.

## Android Device

Run the server before launching the agent. Ensure ADB reverse maps the agent's abstract socket to TCP port 5050:

```sh
adb reverse localabstract:screen-sharing-agent tcp:5050
```

Run `./package-jar.sh` to build the agent and package the complete APK archive under the app_process classpath JAR name. Keeping the APK metadata is required; a JAR containing only `classes.dex` is not loadable by this agent launcher. Then run `./start_agent.sh` to push that archive and the ABI-specific native library and launch the agent. The launcher enables video and audio and requests a 10 Mb/s AVC bitrate. Browser Opus playback requires WebCodecs Opus support.

## Tests

```sh
go test -race ./...
go vet ./...
```