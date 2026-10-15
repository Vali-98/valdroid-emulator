# Performance and Input Latency

The target is sustained 60fps with bounded queueing, not high throughput showing
old frames. At 60fps each frame period is 16.67ms. Capture, Android injection,
AVC encoding, server decoding/JPEG conversion, and browser presentation all matter.

## One Command

From `plugin/`:

```sh
npm ci
npm run test:perf
npm run test:perf -- --duration 60s --warmup 8s --output report.json
```

The runner builds a native server and the separate `tools/perfprobe` executable,
generates a deterministic 1080x2400/60fps AVC replay, starts an isolated server on
temporary loopback ports, and samples **FPS, frame gaps, server CPU, and RAM over
the same measurement window**. It stops its processes and deletes temporary files
even on failure. Nothing installs on a device in default replay mode.

Requires Go and the platform's native C/codec toolchain (see [BUILDING.md](BUILDING.md)).
Replay generation also needs FFmpeg with libx264. Supply `--replay path.h264` to use
an existing Annex-B fixture with access-unit delimiters, parameter sets, and an
initial independently decodable keyframe. `--go-tags turbojpeg` enables the optional
encoder when its development libraries are installed. `--server-binary path` tests
an existing server instead of rebuilding it; use `--transport mjpeg` for old servers.

Default assertions require at least 98% of target FPS, monotonically increasing
PTS, and p95 receive gaps no greater than 1.5 frame periods (25ms at 60fps).
Failures exit nonzero **after emitting the report**. `--no-assert` is useful for
exploration; also inspect p99/max, not just averages. `--json` prints the complete
report; `npm run --silent test:perf -- --json` avoids npm's own stdout headers.

## Live Input and Browser Tests

Use a **dedicated emulator**. These tests install a temporary animation/touch
fixture, bring it to the foreground, and send real touch input:

```sh
npm run test:perf -- --device emulator-5554 --duration 30s
npx playwright install chromium
npm run test:perf -- --device emulator-5554 --browser --duration 30s \
  --screenshot /tmp/valdroid-webview.png --output browser-report.json
```

Live mode needs ADB, the Android SDK/JDK, bash, and built agent assets in
`plugin/bundle/<platform>-<arch>/`. The fixture builds without Gradle or downloaded
dependencies; it defaults to Android platform/build-tools 36. Override
`ANDROID_PLATFORM` / `ANDROID_BUILD_TOOLS` as necessary. `--adb path` selects ADB.

Stop an existing Valdroid stream on that device first. The runner refuses to
overwrite an existing fixture or agent reverse mapping. Afterward it uninstalls
its fixture, removes its reverse mapping, and restores the prior foreground
activity (or Home). It does not stop the emulator or modify global Android settings.

The fixture animates every vsync. Each injected DOWN increments a 16-bit colored
marker. Detecting that counter in JPEG pixels avoids assuming device and host
clocks are synchronized. A static home screen intentionally emits fewer frames
and is not a continuous-60fps workload.

Without `--browser`, taps originate in the Go probe. The report separates host
send to received visual response, input ACK round trip, and server forwarding.
An ACK ends at the **agent socket write**, not Android injection or presentation.
JPEG inspection uses a bounded newest-frame worker; it can miss an earlier
response frame under load, so this is observed-response latency.

With `--browser`, Playwright loads the actual production React webview, sends
mouse gestures through its real input handlers, and detects the response pixels
on an animation-frame callback. This includes browser decode/presentation but
**not physical display scanout or VS Code workbench overhead**. Chromium is an
optional developer tool, not a dependency shipped in the extension. The Go probe
still measures server resources and received frames independently.

## Touch Investigation (2026-10-15)

Apple M4, 10 logical CPUs, Android 36 ARM64 emulator, ImageIO JPEG95:

| Measurement | Mean | p95 |
| --- | ---: | ---: |
| Input ACK round trip, Go-originated taps | 0.186ms | 0.379ms |
| Server encode/write of input command | 0.008ms | 0.015ms |
| Tap to completed JPEG receipt | 57.31ms | 59.79ms |
| Previous MJPEG/image presentation, browser | 95.42ms | 97.20ms |
| WebSocket/predecoded-image experiment, browser | 109.05ms | 95.80ms |
| WebSocket/direct canvas presentation, browser | 77.67ms | 80.90ms |

The WebSocket/image experiment had a 441ms outlier and offered no convincing
typical-latency improvement. Direct `createImageBitmap`/canvas presentation
removed roughly one frame period versus the previous MJPEG/image path. This is
a short-run host comparison, not a universal input-to-photon guarantee. The
baseline browser run used the previous committed server with the same input
handlers; the final run uses the new server and canvas renderer. No builds or
other benchmarks ran during measurement windows.

The final 15-second browser test delivered **900 frames / 60.00fps**, with receive
gaps 21.32ms p95 / 23.44ms p99 / 35.96ms max, and 31 observed tap responses.
Server CPU averaged **22.05% of one core**; RSS averaged **122.12 MiB**, with a
sampled peak of **123.73 MiB**. There were two video subscribers (Go and browser).
The prior 15-second MJPEG test delivered 59.80fps, 23.21% CPU, 118.29 MiB mean
RSS and 123.03 MiB peak. Short warmup/allocator growth prevents a leak conclusion.

The forwarding path was already fast; TCP_NODELAY is already Go's default.
Production changes instead bound stale MOVE traffic, keep DOWN/UP/CANCEL/key
edges immediate, use native raw pointer updates when delivered by the browser,
and render the newest decoded frame directly. Display metadata travels with
each JPEG so rotation/input mapping does not wait for a polling interval.
Remaining latency still includes Android dispatch, capture/encoding, and frame
scheduling; the measured 78ms is not zero latency.

A subsequent 20-second browser run (5s warmup, 41 taps) had 77.30ms median,
83.36ms mean, **107.50ms p95**, and 176.10ms maximum response latency. It delivered
59.70fps with 23.13ms p95 / 29.02ms p99 receive gaps and a 109.57ms maximum gap;
source PTS also had a 64.27ms gap. It passed the configured consistency threshold,
but tail hitches clearly remain. CPU averaged 25.77% of one core; mean/peak RSS
was 110.55/116.31 MiB. Browser pixel/geometry checks passed at 1000x900 and 360x640,
with a visible, height-constrained screen and no control overlap. Typical latency
improved in these runs; tail latency is workload-sensitive, not universally fixed.

## Reading CPU, RAM, and FPS

- CPU uses **100% = one occupied CPU core**, and may exceed 100%. Mean uses total
  user/system CPU time divided by actual elapsed sampling time; p95/max use
  interval samples (250ms default).
- RAM is resident process memory, including native codec allocations. Mean,
  p95, and peak are sampled MiB, not lifetime OS high-water marks. Start/end and
  RSS growth are included. A process exit or PID reuse fails the sample.
- Resources exclude the Android emulator/agent, browser, probe, and separate OS
  services. gopsutil and replay/input generation are only in the standalone tool,
  not linked into the server. `/api/resources` remains a lightweight diagnostic
  snapshot/PID discovery endpoint, not a background benchmark.
- FPS counts complete JPEGs over the entire fixed window, including silence;
  it is not a browser paint count. Receive gaps use the host clock; source PTS
  gaps help distinguish capture irregularity from server processing.
- `serverProcessing` runs from framed AVC packet arrival to video-header
  creation. `replayToReceive` runs from host AVC send to complete JPEG receipt.
  Neither includes Android capture or browser presentation. Cached startup
  frames do not contribute processing samples.
- `/api/performance` retains 600 recent timing samples and cumulative counters.
  Restart between independent comparisons. Multiple viewers increase delivered
  counts, not unique source FPS. Slow viewers can still drop frames.
- Repeat long steady-state windows, rotations, and reconnects before diagnosing
  a leak. macOS results do not substitute for native Linux/Windows testing.

For comparison, a previous 60-second high-detail replay (8s warmup, one MJPEG
subscriber) delivered 60fps at 37.06% CPU, 125.40 MiB mean / 125.52 MiB peak RSS,
and 0.47 MiB RSS growth. The current 5-second WebSocket replay delivered 60fps,
17.57ms p95 gaps, 7.84ms mean send-to-receive, 35.89% CPU and 123.45 MiB peak RSS.
These unequal short/long windows are reference points, not an optimization claim.

Final combined replay recheck: 30 seconds after 5 seconds warmup, **60.00fps**,
17.69ms p95 / 18.58ms p99 receive gaps, 7.58ms mean / 8.24ms p95 host
send-to-receive, **33.55% CPU**, and **122.34 MiB mean / 123.78 MiB peak RSS**.
The default frame-consistency assertions passed.

## Lower-Level Checks

```sh
# From control-server/, for an already-running isolated server:
make perfprobe
./dist/perfprobe --url http://127.0.0.1:38475 --pid SERVER_PID \
  --duration 30s --transport websocket --assert-target
make test
make benchmark
make benchmark GO_TAGS=turbojpeg
```

Native encoder microbenchmarks at 1080x2400/JPEG95 on this host: original Go JPEG
16.54-16.82ms, ImageIO 3.47ms, optional libjpeg-turbo 2.71ms. Encoder quality scales
are not identical, and Go allocation metrics exclude native memory. These are
encoder microbenchmarks, not end-to-end latency. Tests cover serialization,
gesture boundaries, queue replacement, frame envelopes, timeouts, resource
accounting, marker detection, browser cleanup, and display coordinate mapping.
