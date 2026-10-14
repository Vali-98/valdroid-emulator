# Control Server

The Go control server accepts the Android screen-sharing agent's video, audio, and control sockets, decodes AVC to MJPEG, and exposes the stream and input APIs used by the VS Code extension.

## Build

Run `make` to test and build the current host binary plus the Android agent runtime assets in `dist/`:

```sh
make
```

The output layout is:

```text
dist/
  control-server-<goos>-<goarch>[.exe]
  screen-sharing-agent.jar
  agent-libs/<android-abi>/libscreen-sharing-agent.so
```

The `.jar` is the complete Android APK archive under the classpath filename expected by `app_process`; keep its DEX and manifest metadata intact.

## Run

Start the server with the selected Android device serial and this directory's `dist` path:

```sh
./dist/control-server-$(go env GOOS)-$(go env GOARCH) \
  --device-serial emulator-5554 \
  --dist-dir "$PWD/dist"
```

The server binds its HTTP and agent TCP listeners first, installs only changed agent files, configures `adb reverse`, then launches the agent. `/api/status` reports channel readiness and startup failures. The VS Code extension performs AVD selection/startup and passes the selected device serial to the server.

AVC decode prerequisites by host are listed in [BUILDING.md](BUILDING.md).