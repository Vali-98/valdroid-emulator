# Change Log

All notable changes to the "valdroid-emulator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Reduce visible input latency with newest-frame WebSocket/canvas presentation,
  bounded MOVE queues, raw pointer updates, and frame-synchronized input mapping.
- Consolidate video on direct AVC/WebCodecs, removing legacy transports, host
  video decoding, obsolete experiments and benchmarks.
- Prefer loopback ports 38475/38476 and automatically resolve occupied ports
  using the control server's actual listener addresses.
- Initial release
