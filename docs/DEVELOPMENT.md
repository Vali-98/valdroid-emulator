# Development

The extension host manages emulator processes; the webview manages presentation
and browser resources. Their message contract lives in `src/shared/protocol.ts`.

- src/extension.ts: activation and dependency wiring.
- src/host/adb: discovery, commands and logcat processes.
- src/host/session: emulator/server processes and startup announcements.
- src/host/files: APK installation, uploads and file transfer staging.
- src/host/views: VS Code providers, CSP and initial panel sizing.
- src/shared: typed host/webview contracts and console parsing.
- src/webviews/emulator: emulator UI, with media, input and transfers grouped
  by responsibility; hooks own external resources.
- src/webviews/console: console UI, persistence bridge and styles.
- src/webviews/shared: emulator host bridge and shared asset declarations.
- Each webview's index.tsx is its build entry point. Output names remain
  dist/webview.js and dist/console.js.
- tests/host, tests/shared and tests/webviews mirror these boundaries.

## Library Choices

[TanStack Virtual](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual)
renders only visible console rows. `shell-quote` parses quoted ADB arguments;
Android shell commands are passed directly to `adb shell`, never a host shell.

[TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)
owns polling, cancellation, and upload mutation status. Queries consume their
AbortSignal, run against localhost even when the browser reports offline, and
discard unused cached device state. Uploads never retry automatically.

[react-dropzone](https://react-dropzone.js.org/) owns native drag state and file
extraction. Keep its input inside its root and `noDragEventsBubbling` enabled;
VS Code's host drag listeners can otherwise take over the gesture. Extraction
errors and rejected drops are surfaced through transfer feedback.

[eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks)
checks hook order and effect dependencies in both TS and TSX files.

React state/reducers handle local selection and UI state. Pointer capture keeps
drag gestures on the screen without window-level pointer listeners. Additional
state stores and general-purpose hook libraries are unnecessary for this scope.

## Lifecycle

App has no effects. AudioContext survives device selection so a Start-button
gesture can unlock audio; the stream stops on disconnect and the context closes
on app unmount. A keyed PlaybackCanvas owns its WebSocket/decoder through
React ref cleanup; retries replace that canvas. Metadata updates only update
input mapping. Native pointer listeners cancel active gestures on teardown.
CPU percentage is computed from successive successful query samples. Console
preferences persist in user events, not a synchronization effect.

The host monitors the active device and agent channels with sequential health
checks every two seconds, allowing one transient failure. Stopping cancels the
monitor and any startup request. Unexpected loss closes the stream, refreshes
devices and sends a session notice that remains visible on the picker. Notices
and client errors are written to the Valdroid Emulator output channel. An
unchanged screen does not count as a failure.

Startup and keyframe initialization share a centered shimmer loading bar. After
90 seconds of continuous initialization, a white retry link appears below the
status text. Retry cancels the prior attempt before restarting its original
target. Transfer and session feedback share the same toast component.

The remaining effects have external owners: host message subscriptions, control
sockets, audio stream/context ownership and volume synchronization, native input
listeners, upload cancellation, toast/loading timers, and console subscriptions/scroll.
Do not suppress dependency lint or replace these with render-time side effects.

## Development

Run `npm run compile` for types, hook linting, and development bundles, or
`npm run package` for production bundles. Reload the Extension Development Host
after rebuilding. The webview loads both JS and CSS from `dist/`.

Run `npm test` for type checking and the Vitest/Testing Library suite, or
`npm run test:watch` while editing. Tests cover host messages, control sockets,
query cancellation, coordinate mapping, uploads, and drag/drop failure recovery.

Run `npm run test:packaging` for packaging checks and `make test` in
control-server for Go race tests and vet.
The host server forwards AVC without decoding it. See
[AVC playback](#avc-playback) for live presentation and host profiling.

## ADB Console

Open the **Valdroid** bottom-panel tab, use **Valdroid: Show ADB Console** in the
Command Palette, or click the terminal icon in the Emulator view's title bar.
The console automatically follows the currently loaded emulator. It has no
independent device selector; commands remain disabled until the emulator stream
is ready, and stop when that session disconnects.

On the emulator view's first visible open in a workspace, the extension applies
one native VS Code size-increase step (60px). For a side-docked panel this widens
it; for a bottom-docked panel VS Code adjusts height instead. Later user resizing
is preserved. This does not set a CSS minimum width or change global layout settings.

The panel includes colored logcat severity, an installed-package selector,
minimum log-level filtering, case-insensitive text search with highlighted
matches, pause/resume, follow-latest, copy-filtered-output, and clear. Clear affects
local scrollback only, not the Android log buffer. Logcat parsing follows Android's
[threadtime format](https://developer.android.com/tools/logcat). Package association
uses a process-name snapshot refreshed every five seconds, including `:worker`
processes; terminated processes absent from the initial snapshot may remain
unattributed. Search and filtering operate over the latest 5,000 retained lines.

Enter commands such as `shell getprop ro.product.model`, `shell pm list packages`,
or `install "/path/My App.apk"` at the ADB prompt. The selected serial is always
supplied by the extension. Up/Down navigates command history. Commands stream
stdout/stderr, can be canceled, and time out after five minutes. This is a command
runner and log viewer, not an interactive PTY: interactive shells, editors, and
password prompts are not supported. Android shell pipes/quoting work after `shell`;
host shell operators are rejected.

Logcat starts only after the console view is opened, batches UI updates, and keeps
bounded scrollback. Device changes and extension shutdown stop its child processes;
disconnecting retains local diagnostic output until cleared or a new device is selected.

## AVC playback

Video follows one path: Android agent → Go AVC parser → /avc WebSocket →
WebCodecs VideoDecoder → canvas.

The player checks the actual codec with VideoDecoder.isConfigSupported and
configures optimizeForLatency. It decodes every compressed reference frame,
retains only the newest decoded image for the next animation-frame paint,
and explicitly closes VideoFrame objects. Decoder work and server queues are
bounded. Unsupported codecs, decoder errors, and disconnects show an error;
Restart playback starts a fresh connection. A configuration change waits for
an IDR before decoding.

The server builds one immutable Annex-B packet shared across viewers. SPS/PPS
are copied only on configuration changes. Packet construction happens outside
the subscriber mutex. Slow viewers are disconnected instead of dropping
compressed reference frames.

### Wire format

Configuration is a JSON message with type=config, codec (an avc1 codec string),
and display containing id, width, height, and orientation.

Binary messages contain a 32-byte header followed by Annex-B NAL units:

| Offset | Field |
| ---: | --- |
| 0 | ASCII VDAV |
| 4 | Keyframe flag, uint8 |
| 5–7 | Reserved |
| 8 | Source PTS, uint64 microseconds, little-endian |
| 16 | Server receipt Unix milliseconds, uint64 little-endian |
| 24 | Source frame number, uint32 little-endian |
| 28–31 | Reserved |

Keyframes include SPS/PPS before the access unit.

### Live profiling

With the server and emulator running:

```sh
cd plugin
npm run compile
npm run profile -- http://127.0.0.1:38475 30 /tmp/avc-profile.json emulator-5554
```

Requires adb and Playwright Chromium. The script launches Chrome and Settings,
uses the actual React Recent apps button, verifies both apps repeatedly become
foreground, and writes the report outside the repository. Duration is bounded
to 1–300 seconds. The browser test uses the compiled webview in Chromium;
installed VS Code should also be checked.

The canvas dataset avcProfile reports decode/presentation counts, superseded
decoded images, FPS, decoder queue depth, and rolling frame age over the latest
600 presentations. Server-to-canvas age covers server receipt through draw
submission using same-host clocks. It excludes device capture, encoding and
transport before receipt, and compositor/display scanout after submission.

The same report includes server CPU time deltas and heap snapshots during the
workload. CPU is a percentage of one core; it excludes the emulator and browser.

The webview's debug section shows presentation FPS, frame age, decoder queue,
frame counts, and server resource usage. Server resources are polled every two
seconds while debug is open. CPU uses process CPU-time deltas, with 100% meaning
one fully occupied core. Memory shows Go heap usage and reserved heap capacity,
not total process RSS or emulator memory. The CPU field requires an updated
server; unsupported platforms show an unavailable value.

## Test and script scope

Host tests cover processes, listeners, transfers and view sizing. Browser tests
cover resource cleanup, input ordering, query cancellation, media ownership and
file-drop failures; shared tests cover message parsing and filtering. Small unit
tests and interaction tests at these boundaries cover different failures and
are retained. New lifecycle tests verify retry, unmount and metadata updates.

The separate host sampler is consolidated into npm run profile. Build-time
third-party.cjs and package-vsix.cjs remain necessary for licenses and release
validation; package-vsix.test.cjs verifies those constraints. Obsolete UI-absence assertions are removed while console session behavior remains tested.
