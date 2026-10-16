# AVC playback

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

## Wire format

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

## Live profiling

With the server and emulator running:

```sh
cd plugin
npm run compile
npm run profile:avc -- http://127.0.0.1:38475 30 /tmp/avc-profile.json emulator-5554
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

For host process sampling, run npm run profile:host with the same server URL,
duration, and an output path. It samples /api/resources and host CPU/RSS.

The webview's debug section shows presentation FPS, frame age, decoder queue,
frame counts, and server resource usage. Server resources are polled every two
seconds while debug is open. CPU uses process CPU-time deltas, with 100% meaning
one fully occupied core. Memory shows Go heap usage and reserved heap capacity,
not total process RSS or emulator memory. The CPU field requires an updated
server; unsupported platforms show an unavailable value.
