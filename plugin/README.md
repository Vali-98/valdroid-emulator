# Valdroid Emulator

Android emulator streaming and controls inside VS Code, with an ADB/logcat
console that follows the device you are using.

## Features

- Select an Android Virtual Device or an available ADB device.
- Stream the display and audio, with pointer and keyboard input.
- Power, Home, Back, recent-apps, mute, and volume controls alongside the screen.
- Fit the emulator to the available view, without scrolling off the bottom.
- Drop files onto the display to send them to Downloads, with transfer progress.
  APK drops transfer files; they do not automatically install them.
- Colored logcat, package and severity filters, text search, pause, follow, copy,
  and bounded scrollback in the **Valdroid** console.
- Device-scoped ADB commands, command history, and cancellation.

The console is a command runner and log viewer, not an interactive terminal.
Commands such as `shell getprop ro.product.model` and `install "/path/App.apk"`
are supported; interactive shells and password prompts are not.

## Requirements

- Desktop VS Code 1.95 or newer. Browser-only VS Code is not supported.
- Android SDK Platform Tools (`adb`) and an authorized device.
- To launch an emulator: Android SDK Emulator and an existing AVD, created with
  Android Studio's Device Manager or the Android SDK command-line tools.
- Android 8.0/API 26 or newer for the agent; audio capture also depends on the
  Android version and whether the app permits capture.

Packaged extensions contain the Go control server and Android agent; users do
not need Node.js, Go, or a JDK. Consult release notes for host-native runtime
requirements. The extension runs locally, including in Remote SSH workspaces,
and uses the local Android SDK, not the remote machine's SDK.

## Getting Started

1. Install the VSIX for your operating system and CPU architecture using
   **Extensions: Install from VSIX**. Marketplace publication is being prepared.
2. Make `adb` available on PATH and set `ANDROID_HOME` or `ANDROID_SDK_ROOT`
   to your SDK directory, or configure the executable paths below.
3. Run **Valdroid: Show Emulator**, select a device, and press the play button.
4. Open **Valdroid: Show ADB Console** for that same device's logs and commands.

Closing the stream also shuts down an emulator started by Valdroid; independently
started devices are not owned by the extension. Use the debug toggle for stream
status and the **Valdroid Emulator** output channel for startup diagnostics.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `valdroid-emulator.adbPath` | `adb` | Android Debug Bridge executable. |
| `valdroid-emulator.emulatorPath` | SDK discovery | Override the emulator executable. |
| `valdroid-emulator.bitRate` | `10000000` | AVC bitrate in bits per second. |

## Troubleshooting

If a device is missing, check `adb devices` and accept its debugging authorization
prompt. If an AVD is missing, check `emulator -list-avds` using the configured SDK.
Include sanitized output-channel logs, OS/architecture, Android version, and
extension version in bug reports.

Audio starts after a user interaction and respects the client's mute/volume
state. Android or app restrictions may still prevent audio capture.

File transfers use the extension host's ADB process directly; no upload web API
is needed. The control server is for local use only. Do not expose its ports to
untrusted networks. The standalone HTML test page is disabled by default.

## Source and License

[Source code](https://github.com/Vali-98/valdroid-emulator) and
[issue tracker](https://github.com/Vali-98/valdroid-emulator/issues).
Valdroid's original code is AGPL-3.0-only, without warranty. You may use, modify,
and redistribute it under that license. Covered binary distributions require
corresponding source under the applicable terms; modified versions offered for
remote network interaction have additional source-offer requirements.
Third-party components retain their upstream licenses.

Release VSIXs contain `LICENSE`, `NOTICE`, `SOURCE.md`, third-party notices,
and the release's repository source archive. Development-only VSIXs are not releases.

## Support

Contributions and bug reports help keep Valdroid improving. You can also support
development on Ko-fi.

<a href="https://ko-fi.com/vali98"><img src="https://storage.ko-fi.com/cdn/kofi5.png?v=6" alt="Support me on Ko-fi" height="36"></a>
