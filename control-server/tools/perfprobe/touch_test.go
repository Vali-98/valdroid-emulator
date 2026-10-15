package main

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"testing"
)

func TestMarkerSurvivesJPEGAndSystemBarInsets(t *testing.T) {
	for _, sequence := range []int{0, 1, 32768, 65535} {
		pixels := image.NewRGBA(image.Rect(0, 0, 360, 800))
		draw.Draw(pixels, pixels.Bounds(), image.Black, image.Point{}, draw.Src)
		// Use the same fractional cell geometry as the Android fixture.
		for cell := 0; cell < 20; cell++ {
			green := cell < 4 && cell%2 == 0 || cell >= 4 && sequence&(1<<(cell-4)) != 0
			shade := color.RGBA{B: 255, A: 255}
			if green {
				shade = color.RGBA{G: 255, A: 255}
			}
			x0 := int((.1 + .8*float64(cell)/20) * 360)
			x1 := int((.1 + .8*float64(cell+1)/20) * 360)
			draw.Draw(pixels, image.Rect(x0, 80, x1, 110), image.NewUniform(shade), image.Point{}, draw.Src)
		}
		var encoded bytes.Buffer
		if err := jpeg.Encode(&encoded, pixels, &jpeg.Options{Quality: 80}); err != nil {
			t.Fatal(err)
		}
		decoded, err := jpeg.Decode(&encoded)
		if err != nil {
			t.Fatal(err)
		}
		actual, found := markerSequence(decoded)
		if !found || actual != sequence {
			t.Fatalf("sequence %d: got %d, found=%v", sequence, actual, found)
		}
	}
}

func TestMarkerRejectsUnrelatedPixels(t *testing.T) {
	if _, found := markerSequence(image.NewRGBA(image.Rect(0, 0, 200, 400))); found {
		t.Fatal("accepted a blank frame")
	}
}
