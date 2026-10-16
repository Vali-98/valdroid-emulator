# Control Server

The Go server forwards the Android agent's compressed AVC to the VS Code
webview over WebSocket. Android encodes the video; the browser's WebCodecs
VideoDecoder decodes it. Audio and input use separate agent channels.

## Build and run

Run `make plugin-bundle` to build the server and Android agent and copy them
into the current platform's plugin bundle. Build instructions are below.

For a manual launch from this directory:

```sh
go run . --device-serial emulator-5554 --dist-dir dist
```

The server binds HTTP and agent TCP listeners, installs changed agent files,
configures adb reverse, and launches the agent. Defaults are loopback ports
38475 (HTTP) and 38476 (agent). Use --http and --socket to override them;
--auto-port allows a fallback when a requested port is occupied. Port 0 requests
an OS-assigned port. --announce-listeners emits the actual addresses as a JSON
line, which the extension uses before polling readiness.

## APIs

- /avc?display=0: compressed AVC frames and configuration over WebSocket.
- /control: touch/key input over WebSocket.
- /audio: agent audio over WebSocket.
- /api/display-state?display=0: logical dimensions and orientation.
- /api/status: channel readiness and agent startup errors.
- /api/resources: current process and Go runtime diagnostics.
- /api/volume: device media volume.

File transfers and APK installation run through adb in the extension host.

Video frames share one immutable Annex-B packet across viewers. Codec
configuration is copied only when it changes. Each viewer has a bounded queue;
a slow viewer is disconnected rather than losing compressed reference frames.
Socket writes have a 250 ms deadline. New viewers wait for an IDR keyframe.

Control messages may include requestId to receive an input-ack with
serverForwardUs. This confirms forwarding to the agent socket. Adjacent
unacknowledged MOVE commands can be coalesced; gesture and key boundaries
remain ordered.

See [AVC playback](../docs/DEVELOPMENT.md#avc-playback) for the wire format and live profiling.

## Layout

- internal/agent: installation and agent startup.
- internal/device: device APIs.
- internal/diagnostics: Go runtime diagnostics.
- internal/server: listeners, AVC forwarding, audio, input, and HTTP APIs.

The host server builds with CGO_ENABLED=0. Tests live beside their packages.

## Building the host server

Install Go, then run:

```sh
make server
```

The binary is written to dist/control-server-<goos>-<goarch>[.exe].
Cross-compilation is supported by Go; for example:

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o dist/control-server-linux-amd64 .
```

## Android agent and extension bundle

Install the Android SDK, NDK, CMake, and JDK required by the vendored Gradle
project in third_party/screen_sharing_service. The agent still uses Android
native libraries.

```sh
make agent
make plugin-bundle
```

The bundle contains the host server, screen-sharing-agent.jar (the complete APK
archive used by app_process), and agent-libs/<android-abi>/libscreen-sharing-agent.so.
Supported Android ABIs are arm64-v8a, armeabi-v7a, x86, and x86_64.
Keep the agent archive and libraries from the same build.

## Checks

```sh
make test
```

Race tests require the host's Go race-detector toolchain. Production server
builds use CGO_ENABLED=0. From plugin, run npm test, npm run test:packaging, and
npm run compile. See [development](../docs/DEVELOPMENT.md) and
[releasing](../docs/RELEASING.md) for the extension workflow.
