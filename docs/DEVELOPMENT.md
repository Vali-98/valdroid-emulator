# Plugin Structure

The extension host manages emulator processes; the webview manages presentation
and browser resources. Their message contract lives in `src/shared/protocol.ts`.

- `src/extension.ts`: VS Code activation, commands, and dependency wiring.
- `src/lib/`: ADB discovery, child processes, and emulator/server lifecycle.
- `src/lib/AdbFileTransfer.ts`: Serial-scoped APK installation and Downloads
  transfers. `FileUploadReceiver.ts` stages webview chunks and cleans up local files.
- `src/lib/serverConnection.ts`: Preferred loopback endpoints and the server's
  JSON startup announcement. Port fallback is performed by the Go listener itself.
- `src/view/`: Webview registration, typed host messages, and HTML/CSP generation.
- `src/webview.tsx`: Browser entry point and QueryClient provider.
- `src/console.tsx`, `src/console/`: Virtualized ADB/logcat panel and console styles.
- `src/lib/AdbConsole.ts`: Serial-scoped logcat, command execution, metadata, and process cleanup.
- `src/shared/console.ts`: Console messages, logcat parsing, and filters.
- `src/webview/App.tsx`: Device selection and the connected emulator workspace.
- `src/webview/components/`: Header, picker, screen, controls, transfer feedback,
  and debug footer.
- `src/webview/hooks/`: Host session, control socket, input, audio, file transfers,
  and Dropzone integration.
- `src/webview/api.ts`: Shared query defaults, polling, and socket URLs.
- `src/webview/audio.ts`, `avcVideo.ts`, `controlSender.ts`, `input.ts`, `upload.ts`: Browser transport and device
  logic independent of UI components.
- `src/webview/styles.css`: Styles bundled into `dist/webview.css` by esbuild.

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

## Lifecycle Rules

The connected workspace unmounts when the server disconnects. It owns the
control socket, pending upload controller, debug state, and transfer notices.
AudioContext survives device selection so it can be resumed during the Start
button gesture; its stream is disposed on disconnect and its context is closed
when the app unmounts. Audio decoding stays sequential and separate from polling.

Effects should synchronize external resources. Derived values such as titles,
screen metadata, transfer status, and selection fallback belong in render logic
or reducers instead of effects.

## Development

Run `npm run compile` for types, hook linting, and development bundles, or
`npm run package` for production bundles. Reload the Extension Development Host
after rebuilding. The webview loads both JS and CSS from `dist/`.

Run `npm test` for type checking and the Vitest/Testing Library suite, or
`npm run test:watch` while editing. Tests cover host messages, control sockets,
query cancellation, coordinate mapping, uploads, and drag/drop failure recovery.

Run `npm test`, `npm run test:packaging`, and `npm run compile` for plugin
checks. Run `make test` in control-server for Go race tests and vet.
The host server forwards AVC without decoding it. See
[AVC playback](AVC-PLAYBACK.md) for live presentation and host profiling.

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
