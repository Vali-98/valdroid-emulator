#!/bin/sh
set -eu

for package in libavcodec libavutil libswscale; do
  pkg-config --exists "$package" || {
    echo "Missing $package development package. Install FFmpeg development libraries and pkg-config." >&2
    exit 1
  }
done

CGO_ENABLED=1 go build -o emu-stream .