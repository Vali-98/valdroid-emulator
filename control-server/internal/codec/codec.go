// Package codec owns native codec handles and decoded pixel-buffer lifetimes.
package codec

import (
	"image"
	"time"
)

const JPEGEncoderName = jpegEncoderName

type Decoder struct{ native *h264Decoder }

func NewDecoder(sps, pps []byte, width, height int, orientation uint8) (*Decoder, error) {
	native, err := newH264Decoder(sps, pps, width, height, orientation)
	if err != nil {
		return nil, err
	}
	return &Decoder{native: native}, nil
}

// Decode transfers ownership of the returned pixels to the caller.
func (d *Decoder) Decode(nalus [][]byte, timestamp time.Duration) (*image.RGBA, error) {
	return d.native.decode(nalus, timestamp)
}
func (d *Decoder) Close() { d.native.close() }

type JPEGEncoder struct{ native jpegEncoder }

func NewJPEGEncoder() (*JPEGEncoder, error) {
	native, err := newJPEGEncoder()
	if err != nil {
		return nil, err
	}
	return &JPEGEncoder{native: native}, nil
}

// Encode returns immutable JPEG bytes independent of the input pixel buffer.
func (e *JPEGEncoder) Encode(frame *image.RGBA, quality int) ([]byte, error) {
	return e.native.encode(frame, quality)
}
func (e *JPEGEncoder) Close() { e.native.close() }

// ReleaseFrame returns an exclusively owned frame after encoding or queue eviction.
func ReleaseFrame(frame *image.RGBA) { releaseDecodedFrame(frame) }
