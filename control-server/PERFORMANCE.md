# Frame Pacing and Latency

The target is sustained 60fps with bounded queueing, not a backlog that reports high throughput while showing old frames. At 60fps there is 16.67ms between frames. Capture, agent AVC encoding, transport, server decode/JPEG conversion, and browser decode/render all contribute to the result.

## Encoder Baseline

Measured on an Apple M4, darwin/arm64, at 1080x2400 and JPEG quality 95 using the deterministic UI-like image in `pipeline_benchmark_test.go`:

| Encoder | Average encode time | Go bytes allocated per encode |
| --- | ---: | ---: |
| Original Go `image/jpeg` path | 16.54-16.82ms | 524,784 |
| Default macOS ImageIO | 3.47ms | 229,376 |
| Optional libjpeg-turbo | 2.71ms | 237,576 |

These are encoder microbenchmarks, not end-to-end latency or identical visual-quality guarantees. JPEG encoders interpret quality differently. Go allocation counts exclude native allocations; complex/noisy images can cost more than this fixture.

The macOS decoder uses synchronous VideoToolbox calls so native code can read a reusable Go packet without retaining its pointer after the call. This depends on keeping asynchronous/temporal-processing flags disabled, as specified in [Apple's decode API contract](https://developer.apple.com/documentation/videotoolbox/vtdecompressionsessiondecodeframe(_:samplebuffer:flags:framerefcon:infoflagsout:)). The optional encoder uses the existing [libjpeg-turbo API](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/src/turbojpeg.h), with worker-owned native output storage and an immutable Go copy for fanout.

```sh
make benchmark
make benchmark GO_TAGS=turbojpeg
```

## Reproducible Server Replay

This isolates the server from Android capture/encoder variability. Requires FFmpeg with libx264 to generate a fixture; the running server does not invoke FFmpeg. Use a separate server with no real agent connected.

```sh
make server frameprobe
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i 'testsrc2=size=1080x2400:rate=60' -t 3 \
  -c:v libx264 -preset ultrafast -tune zerolatency -g 60 -bf 0 \
  -b:v 10M -pix_fmt yuv420p -bsf:v h264_metadata=aud=insert \
  -f h264 -y /tmp/valdroid-perf.h264
./dist/control-server-$(go env GOOS)-$(go env GOARCH) \
  --http 127.0.0.1:18080 --socket 127.0.0.1:15050
```

In another terminal:

```sh
./dist/frameprobe --url http://127.0.0.1:18080 \
  --agent 127.0.0.1:15050 --replay /tmp/valdroid-perf.h264 \
  --width 1080 --height 2400 --duration 30s --assert-target
```

The fixture must contain access-unit delimiters and start with an independently decodable keyframe plus parameter sets. The generated fixture loops with a fresh IDR at its beginning. `--fps` controls replay cadence and the assertion target. Do not replay into a server already receiving a real agent's display 0.

The first measured 12-second replay on this host delivered 60.00fps, 17.58ms p95 and 18.07ms p99 receive gaps, 7.19ms mean and 8.34ms p95 server processing, and no decode/encode errors. One frame was replaced during initial startup before the measured window; no client frames were dropped. The original committed server delivered 52.58fps on the identical fixture, with 20.34ms p95 gaps and 33.33ms source-PTS jumps when frames were skipped. It failed the same target assertion.

## Real Android Agent and Input

Use a dedicated emulator/device. `--exercise-input` repeatedly sends vertical swipes through the same control WebSocket as the extension; it changes the foreground app's state. A static home screen intentionally produces few frames and is not a valid continuous-60fps fixture.

`tools/frame-clock` supplies a dependency-free Android test app that redraws moving bars and a frame counter every vsync, and displays a marker at injected touch coordinates. The build uses your installed JDK and Android SDK, generates a temporary signing key, and does not require Gradle or downloaded dependencies. Defaults are Android platform 36 / build-tools 36.0.0; override `ANDROID_PLATFORM` and `ANDROID_BUILD_TOOLS` as needed.

```sh
bash tools/frame-clock/build.sh /tmp/valdroid-frame-clock.apk
adb -s emulator-5554 install -r /tmp/valdroid-frame-clock.apk
adb -s emulator-5554 shell am start -n dev.valdroid.frameclock/.FrameClock
./dist/control-server-$(go env GOOS)-$(go env GOARCH) \
  --device-serial emulator-5554 --dist-dir "$PWD/dist"
```

In another terminal:

```sh
./dist/frameprobe --duration 60s --warmup 3s --exercise-input --assert-target
adb -s emulator-5554 uninstall dev.valdroid.frameclock
```

On the same Apple M4 / Android 36 ARM64 emulator, the 1080x2400 live test with automated swipes delivered **3,600 frames in 60 seconds**. Receive gaps were 17.92ms p95 / 18.73ms p99 / 28.14ms maximum; server processing was 4.76ms mean / 5.29ms p95 / 5.53ms p99. There were no encode/client drops or decode/encode errors. The original server also managed 59.97fps on this relatively simple live animation, with 18.59ms p95 / 20.04ms p99 receive gaps; the improvement should not be described as turning every previously slow workload into 60fps. The native encoder provides substantially more processing headroom.

## Reading Results

- FPS counts complete received JPEGs over the fixed measurement window, including periods of silence. It does not count browser paints.
- `receiveIntervals` measures complete JPEG delivery gaps on the probe's host clock. Source PTS gaps identify capture/agent irregularity independently of server processing.
- `serverProcessing` measures complete-packet arrival (after AVC framing) to HTTP header emission. The endpoint's `serverResidence` extends this through HTTP flush. Neither includes device capture/encode, packet ingress, browser decoding/painting, or input-to-photon latency. Device and host clocks are not assumed synchronized.
- `--assert-target` exits nonzero below 98% of target FPS, for nonmonotonic presentation timestamps, or if the p95 receive gap exceeds 1.5 frame periods (25ms at 60fps). Review p99/max too; a passing average is not a guarantee of zero hitches.
- `/api/performance` retains the latest 600 timing samples, with cumulative counters since server start. Restart the server between independent comparisons. A cached frame on initial subscription is excluded from processing latency.
- Replay pacing depends on the load generator's scheduling. Compare arrival/source intervals before attributing a gap to decoding. Repeat tests without benchmarks/builds running concurrently.
- MJPEG has significant bandwidth and browser decode overhead. A slow webview, remote host, overloaded emulator, or slower platform codec can still miss 60fps even when the server replay passes. Linux and Windows native execution must be measured on those hosts.

## Regression Checks

```sh
make test
go test -count 10 -run 'TestJPEG|TestDecodedQueue|TestClientQueue|TestPerformance' .
```

Tests cover AVC framing, JPEG color/dimension preservation, published-buffer ownership, newest-frame replacement/drop accounting, cached-frame startup, timing windows, audio framing, control serialization, and HTTP/WebSocket paths. The live/replay probe complements unit tests by exercising real native decoding and sustained pacing.
