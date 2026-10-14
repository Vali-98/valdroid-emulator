package main

import (
	"bytes"
	"image"
	"image/jpeg"
	"testing"
)

func benchmarkImage(width, height int) *image.RGBA {
	frame := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			i := y*frame.Stride + x*4
			frame.Pix[i], frame.Pix[i+1], frame.Pix[i+2], frame.Pix[i+3] = byte(x/4), byte(y/4), byte((x+y)/8), 255
		}
	}
	return frame
}

func BenchmarkJPEGStandardLibrary(b *testing.B) {
	for _, size := range []struct {
		name          string
		width, height int
	}{{"360x800", 360, 800}, {"720x1600", 720, 1600}, {"1080x2400", 1080, 2400}} {
		b.Run(size.name, func(b *testing.B) {
			frame := benchmarkImage(size.width, size.height)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				var buffer bytes.Buffer
				if err := jpeg.Encode(&buffer, frame, &jpeg.Options{Quality: 95}); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkJPEGEncoder(b *testing.B) {
	for _, size := range []struct {
		name          string
		width, height int
	}{{"360x800", 360, 800}, {"720x1600", 720, 1600}, {"1080x2400", 1080, 2400}} {
		b.Run(size.name, func(b *testing.B) {
			frame := benchmarkImage(size.width, size.height)
			encoder, err := newJPEGEncoder()
			if err != nil {
				b.Fatal(err)
			}
			defer encoder.close()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := encoder.encode(frame, 95); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
