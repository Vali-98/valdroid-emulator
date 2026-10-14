//go:build (!darwin && !windows && !linux) || !cgo

package main

import (
	"errors"
	"image"
	"time"
)

type h264Decoder struct{}

func newH264Decoder(sps, pps []byte, width, height int, orientation uint8) (*h264Decoder, error) {
	return nil, errors.New("H.264 to MJPEG decoding requires cgo and VideoToolbox, Media Foundation, or Linux FFmpeg libraries")
}

func (d *h264Decoder) decode(nalus [][]byte, timestamp time.Duration) (*image.RGBA, error) {
	return nil, errors.New("VideoToolbox decoder is unavailable")
}

func (d *h264Decoder) close() {}
