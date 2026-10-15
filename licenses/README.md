# Dependency Notices

These notices cover runtime components whose npm packages do not contain a
complete license file, or which are embedded inside another component.
Other JavaScript notices are collected from installed packages at build time.

- `wasm-audio-decoders.txt`: standard MIT terms for `opus-decoder` 0.7.12 and
  `@wasm-audio-decoders/common` 9.0.7. Their package manifests declare MIT; the
  bundled decoder identifies Copyright 2021-2026 Ethan Halsall. Upstream's
  [licensing statement](https://github.com/eshaz/wasm-audio-decoders/tree/3c74930e673bea39f22e344032c5100e73b69b82#licensing)
  also distinguishes its MIT code from the embedded codecs.
- `opus.txt`: upstream libopus COPYING at commit
  `ddbe48383984d56acd9e1ab6a090c54ca6b735a6`, the Opus submodule referenced by
  that wasm-audio-decoders tree.
- `puff.txt`: upstream zlib 1.3.1 `contrib/puff/puff.h` notice. The WASM audio
  packages use puff for decompression; its license is retained separately.
- `gorilla-websocket.txt`: upstream gorilla/websocket v1.5.3 LICENSE, the Go
  server's linked external module. Probe-only Go dependencies are not shipped.
- `go.txt`: Go 1.26.1's LICENSE, covering the server's linked Go runtime.
- `llvm-runtime.txt`: LLVM 19.1.7 libc++ license and LLVM exceptions, retained
  for the C++ runtime compiled into the Android agent. Recheck with NDK updates.

Re-audit these notices when updating dependencies. Native codec libraries
added to future Linux/Windows distributions need their own notices and any
required corresponding source; these files do not cover arbitrary FFmpeg,
TurboJPEG, or compiler-runtime builds.
