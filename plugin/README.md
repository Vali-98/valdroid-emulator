# Plugin Structure

The extension host manages emulator processes; the webview manages presentation
and browser resources. Their message contract lives in `src/shared/protocol.ts`.

- `src/extension.ts`: VS Code activation, commands, and dependency wiring.
- `src/lib/`: ADB discovery, child processes, and emulator/server lifecycle.
- `src/view/`: Webview registration, typed host messages, and HTML/CSP generation.
- `src/webview.tsx`: Browser entry point and QueryClient provider.
- `src/webview/App.tsx`: Device selection and the connected emulator workspace.
- `src/webview/components/`: Header, picker, screen, controls, transfer feedback,
  and debug footer.
- `src/webview/hooks/`: Host session, control socket, input, audio, file transfers,
  and Dropzone integration.
- `src/webview/api.ts`: Shared query defaults, polling, and socket URLs.
- `src/webview/audio.ts`, `input.ts`, `upload.ts`: Browser transport and device
  logic independent of UI components.
- `src/webview/styles.css`: Styles bundled into `dist/webview.css` by esbuild.

## Library Choices

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
