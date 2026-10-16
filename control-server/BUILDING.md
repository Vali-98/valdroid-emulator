# Building

The host server is pure Go and builds with CGO_ENABLED=0. It forwards AVC to
the webview, where WebCodecs performs video decoding.

## Server

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
