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

Listeners default to loopback-only `127.0.0.1:38475` (HTTP) and
`127.0.0.1:38476` (agent). Add `--auto-port` to let the OS choose a free port
when either requested port is occupied; explicit `--http`/`--socket` addresses
otherwise fail on conflicts. Port `0` also requests an OS-assigned port directly.
Logs show the actual addresses, and ADB reverse always uses the actual agent port.

The plugin passes `--auto-port --announce-listeners`. The latter prints one
JSON line on stdout after both listeners are bound, for example:

```json
{"type":"server-listening","httpUrl":"http://127.0.0.1:38475","socketAddress":"127.0.0.1:38476"}
```

The extension waits for that announcement before polling readiness or loading
its webview. It never assumes the preferred port belongs to its own process.

The standalone test page at `/` is disabled by default. Add `--test-webserver` when running the server manually to serve it. The VS Code extension does not use this flag. `/api/volume` reports the device's media volume. File transfers are handled by the VS Code extension host with `adb push` to `/sdcard/Download`; the server exposes no upload endpoint.

AVC decode prerequisites by host are listed in [BUILDING.md](BUILDING.md).

## Layout

```text
main.go                         CLI entry point
internal/
  agent/                        ADB installation and agent startup
  codec/                        Native AVC/JPEG backends and pixel-buffer ownership
  device/                       Device APIs (media volume)
  diagnostics/                  Go heap/GC snapshots
  server/                       Listeners, channels, streaming, control, and telemetry
    web/                        Embedded standalone test client
tools/
  perfprobe/                    Combined external CPU/RSS/FPS/latency benchmark
  frame-clock/                  Repeatable Android animation/touch fixture
```

Tests and encoder benchmarks live beside their owning packages. The server injects channel-readiness checks into agent startup; the agent and native codec packages do not depend on HTTP/server state. The codec API explicitly transfers ownership of decoded pixels to the pipeline, which returns them after encoding or queue eviction. `go run .`, `go build .`, and the existing launch scripts still use the root entry point.

Video queues retain only the newest pending frame. A slow encoder or viewer drops stale work instead of accumulating latency. Each pixel buffer has one owner until encoding completes; published JPEG bytes are immutable and shared between viewers. Slow HTTP writes time out without blocking capture or other viewers.

## Performance

`/api/performance?display=0` reports frame/drop/error counts and rolling mean/p50/p95/p99/max timings for decode, JPEG encoding, queueing, source cadence, arrival cadence, HTTP writes, and server residence. Counters are cumulative since server start; timing windows retain the latest 600 samples. Delivered-frame counts include all subscribers, not unique source frames.

`--jpeg-quality` defaults to 95. macOS uses the system ImageIO encoder without additional runtime dependencies. Linux/Windows default to the portable Go encoder; build with `make server GO_TAGS=turbojpeg` to use SIMD-accelerated libjpeg-turbo when its development libraries and `pkg-config` are available. Lower JPEG quality can reduce CPU and bandwidth, but does not change the agent's AVC bit rate.

See [PERFORMANCE.md](PERFORMANCE.md) for measurements, automated input, reproducible 60fps replay/live tests, and the limits of these latency measurements.

From `plugin/`, run `npm run test:perf` for an isolated replay with aligned CPU,
RSS, FPS, and latency measurements. Add `-- --device emulator-5554 --browser` for
the actual React input/presentation path on a dedicated emulator. All load
generation and process sampling live in `tools/perfprobe`, outside the server;
`make perfprobe` builds it separately. See [PERFORMANCE.md](PERFORMANCE.md).

## Video Transport

The plugin uses binary JPEG messages on `/video`, decodes at most one frame at
a time, and retains only the newest pending frame for direct canvas drawing.
The standalone test page still uses `/stream` MJPEG. Both share immutable JPEGs
and one-frame subscriber queues. Slow WebSocket writes time out after 250ms.

Each `/video?display=0` binary message contains a 40-byte header followed by JPEG:

| Offset | Field (little-endian except ASCII magic) |
| ---: | --- |
| 0 | `VDJP` magic, 4 bytes |
| 4 | Display ID, int32 |
| 8, 12 | Logical display width / height, uint32 |
| 16 | Orientation, uint32 (0-3) |
| 20 | Frame number, uint32 |
| 24 | Presentation timestamp, uint64 microseconds |
| 32 | Server processing, uint64 microseconds (0 for cached startup) |

Control messages may include a `requestId` to receive an `input-ack` with that ID
and `serverForwardUs`. The ACK confirms the agent socket write only. Normal UI
commands omit this field. Adjacent unacknowledged MOVE commands may be coalesced;
gesture/key boundaries and acknowledged commands remain ordered.
