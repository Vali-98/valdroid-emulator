//go:build !cgo || (!darwin && !turbojpeg)

package main

import (
	"bytes"
	"image"
	"image/jpeg"
)

const jpegEncoderName = "Go image/jpeg"

type portableJPEGEncoder struct{ buffer bytes.Buffer }

func newJPEGEncoder() (jpegEncoder, error) { return &portableJPEGEncoder{}, nil }
func (e *portableJPEGEncoder) encode(frame *image.RGBA, quality int) ([]byte, error) {
	e.buffer.Reset()
	if err := jpeg.Encode(&e.buffer, frame, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return append([]byte(nil), e.buffer.Bytes()...), nil
}
func (e *portableJPEGEncoder) close() {}
