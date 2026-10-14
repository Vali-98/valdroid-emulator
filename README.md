# Valdroid Emulator Stream Test

This project streams and controls an Android emulator from a VS Code side panel.

## Parts

- `control-server/`: Go server that starts the Android screen-sharing agent, receives video/audio/control channels, decodes H.264 video, and exposes local HTTP/WebSocket endpoints for the UI.
- `plugin/`: VS Code extension that lists Android AVDs and running ADB devices, starts the bundled control server, and renders the emulator stream in a webview panel.
- `start_agent.sh`, `start_emu.sh`, `build_linux.sh`, `package-jar.sh`: helper scripts for local emulator, agent, and platform build workflows.

## Build

Build the control server from `control-server/`:

```sh
make
```

This also copies the host server binary and Android agent assets into `plugin/bundle/<goos>-<goarch>/`, which is where the VS Code extension loads them from.

Build the VS Code extension from `plugin/`:

```sh
npm install
npm run package
```

## Use

Open the extension in VS Code's extension development host, then run `Valdroid: Show Emulator` or open the `Android Emulator` panel. Pick an AVD or connected device, press `Start`, and use `Stop` or `x` to shut down the stream/emulator started by the extension.

Android SDK tools must be available through `adb` and `emulator`, or configured with `valdroid-emulator.adbPath` and `valdroid-emulator.emulatorPath`.
