# Screen Sharing Agent Functionality Report

## Executive summary

`third_party/screen-sharing-agent` is an Android-side screen and audio capture
agent with a host-driven control channel. It is designed to be launched on a
device by Android's `app_process`, then connect back to local abstract Unix
domain sockets opened by its host. The host can start and stop streams, inject
input, synchronize clipboard data, and query or modify selected device state.

The agent does **not** produce MJPEG, run a network server, or provide a
standalone simulator service. Its video output is encoded by an Android
`MediaCodec` encoder (the requested codec is selected from the device's
available encoders); audio output is Opus. A separate host-side component
would need to consume these channels and, for an MJPEG consumer, decode and
convert the video.

## Runtime and startup

The Java entry point is
[`Main.java`](third_party/screen-sharing-agent/app/src/main/java/com/android/tools/screensharing/Main.java).
It loads
`/data/local/tmp/.studio/libscreen-sharing-agent.so` and passes command-line
arguments to the native JNI entry point in
[`main.cc`](third_party/screen-sharing-agent/app/src/main/cpp/main.cc). The
native [`Agent`](third_party/screen-sharing-agent/app/src/main/cpp/agent.cc)
parses options including:

- `--socket=` for the abstract local socket name (default:
  `screen-sharing-agent`)
- `--codec=`, `--max_size=WIDTH,HEIGHT`, and `--max_bit_rate=`
- `--orientation=`, `--flags=`, and `--log=`

The native library uses C++20 and Android NDK media and system APIs. Gradle
configures an Android application module with external CMake compilation and
`minSdk` 26. The runtime model in the source is direct `app_process` execution,
not ordinary foreground-app operation. The project configuration builds an
Android package containing the native library; the launcher itself expects the
library at the fixed device path above.

## Socket channels and media output

The agent is a socket **client**: the host must create/listen on the abstract
Unix domain socket, and the agent connects to it. It opens separate connections
for video, audio when the Android feature level is at least 31, and control.
Each connection begins with a channel marker:

| Channel | Marker and initial data | Payload |
| --- | --- | --- |
| Video | `V`, then a 20-byte codec-name field padded with spaces | Repeated native video packet headers followed by encoded packet bytes |
| Audio | `A` | Repeated 32-bit audio packet headers followed by encoded Opus bytes |
| Control | `C` | Base-128 (LEB128) encoded control messages and responses |

### Video

[`DisplayStreamer`](third_party/screen-sharing-agent/app/src/main/cpp/display_streamer.cc)
captures a display through a virtual display or the platform's display-control
path, feeds it to an Android surface-input `MediaCodec` encoder, and writes
encoded packets to the video socket. The codec is requested with `--codec=`;
the agent looks up a matching device encoder and fails startup if none is
available. It does not convert the stream to JPEG.

The binary packet header, defined by
[`video_packet_header.h`](third_party/screen-sharing-agent/app/src/main/cpp/video_packet_header.h),
contains display ID and natural dimensions, orientation and correction, flags,
bit rate, frame number, origination and presentation timestamps, and packet
size. It is written as a native structure followed by the encoded packet. A
zero presentation timestamp identifies a codec-configuration packet. Header
and payload are not an MJPEG framing format.

The agent can stream the primary display and additional displays, with
per-display start/stop, orientation, and maximum-resolution controls. It sizes
frames to fit both the requested maximum and encoder capabilities, and adapts
to codec errors by reducing bit rate. The configured frame rate is capped at
60 fps (30 fps for watches and glasses, subject to the encoder's limit); this
is a cap, not a promise of a fixed output cadence.

### Audio

[`AudioStreamer`](third_party/screen-sharing-agent/app/src/main/cpp/audio_streamer.cc)
encodes stereo audio at 48 kHz as Opus at a configured 128 kbit/s. It uses
`AudioRecordReader` on feature level 34 and later, and otherwise uses
`RemoteSubmixReader`; on newer devices it can fall back to remote submix if
audio-record capture cannot start. The packet header is a 32-bit size field:
the high bit marks a codec-configuration packet and the remaining bits give
the payload size. Audio is available only when the host/device setup supports
the audio channel, and may be started at launch with a flag or later through
the control channel.

## Control channel

The control protocol is implemented in
[`control_messages.h`](third_party/screen-sharing-agent/app/src/main/cpp/control_messages.h),
[`control_messages.cc`](third_party/screen-sharing-agent/app/src/main/cpp/control_messages.cc),
and [`controller.cc`](third_party/screen-sharing-agent/app/src/main/cpp/controller.cc).
Messages are serialized with unsigned little-endian base-128 variable-length
integers; floating-point values are fixed-width IEEE 754 values. The host sends
message type IDs and fields; correlated requests carry request IDs, and the
agent returns responses or asynchronous notifications.

Supported command families include:

- **Input:** touch/motion and mouse-like pointer events, keyboard key events,
  and Unicode text. Depending on flags, Android version, and device support,
  pointer or key input can use virtual input devices.
- **Display and video:** start/stop video for a display, set maximum
  resolution, change/reset video orientation, and request display
  configurations. Display add/change/remove events are reported to the host.
- **Audio:** start and stop the audio stream.
- **Clipboard:** initialize synchronization with host text and a maximum
  synchronized length, receive clipboard-change notifications, and stop
  notifications.
- **Device state:** request a foldable device state and receive supported
  states/current-state notifications.
- **XR:** send rotation, translation, angular velocity, and velocity; recenter;
  set passthrough coefficient or environment; and receive XR environment or
  input-availability notifications.
- **UI settings:** query settings, change supported settings (such as dark
  mode, font scale, density, accessibility options, navigation, debug layout,
  or app locale), and restore original settings.

The controller handles commands in a loop, monitors display/device/clipboard
changes, and coordinates orderly shutdown. The agent also keeps track of
system settings it changes and restores the saved environment when it exits.
Some operations are gated by Android feature/API level and hardware support;
their availability is not uniform across devices.

## What this means for the simulator-server goal

The current project goal describes a Windows simulator server that consumes
agent data and ultimately supplies MJPEG and audio to a VS Code extension. The
agent provides useful capture, input, and device-control functionality, but it
is only the Android endpoint and does not satisfy the server or MJPEG portions
of that goal.

An interoperable host/server therefore needs to:

1. Create the abstract Unix socket expected by the agent and accept the
   channel connections in the order the agent opens them.
2. Parse the `V`/`A`/`C` channel setup and each channel's framing correctly.
3. Decode the selected encoded video codec and re-encode frames as MJPEG if
   MJPEG is the required downstream format.
4. Handle Opus audio separately and define how it is transported to the
   extension.
5. Implement the control protocol if remote input, stream lifecycle, display
   metadata, clipboard, or other controls are needed.

The checked-in setup notes that the existing Windows executable's internals
are unknown. Its behavior and the exact protocol it expects are therefore not
established by this source review; the agent's socket and packet details above
come from `screen-sharing-agent` itself.

## Source map

- Native startup, socket connection, channel setup, and flags:
  [`agent.cc`](third_party/screen-sharing-agent/app/src/main/cpp/agent.cc),
  [`flags.h`](third_party/screen-sharing-agent/app/src/main/cpp/flags.h)
- Video capture and packet emission:
  [`display_streamer.cc`](third_party/screen-sharing-agent/app/src/main/cpp/display_streamer.cc),
  [`video_packet_header.h`](third_party/screen-sharing-agent/app/src/main/cpp/video_packet_header.h)
- Audio capture and encoding:
  [`audio_streamer.cc`](third_party/screen-sharing-agent/app/src/main/cpp/audio_streamer.cc)
- Control definitions and dispatch:
  [`control_messages.h`](third_party/screen-sharing-agent/app/src/main/cpp/control_messages.h),
  [`control_messages.cc`](third_party/screen-sharing-agent/app/src/main/cpp/control_messages.cc),
  [`controller.cc`](third_party/screen-sharing-agent/app/src/main/cpp/controller.cc)
- Java launcher and codec discovery:
  [`Main.java`](third_party/screen-sharing-agent/app/src/main/java/com/android/tools/screensharing/Main.java),
  [`CodecInfo.java`](third_party/screen-sharing-agent/app/src/main/java/com/android/tools/screensharing/CodecInfo.java)
- Android and native build configuration:
  [`app/build.gradle.kts`](third_party/screen-sharing-agent/app/build.gradle.kts),
  [`CMakeLists.txt`](third_party/screen-sharing-agent/app/src/main/cpp/CMakeLists.txt)
