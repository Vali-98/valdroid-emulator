package codec

import (
	"bytes"
	"image"
	"image/jpeg"
	"testing"
)

func TestJPEGEncoderPreservesColorsAndOwnsOutput(t *testing.T) {
	encoder, err := newJPEGEncoder()
	if err != nil {
		t.Fatal(err)
	}
	defer encoder.close()
	frame := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for i := 0; i < len(frame.Pix); i += 4 {
		frame.Pix[i], frame.Pix[i+3] = 255, 255
	}
	first, err := encoder.encode(frame, 95)
	if err != nil {
		t.Fatal(err)
	}
	original := append([]byte(nil), first...)
	for i := 0; i < len(frame.Pix); i += 4 {
		frame.Pix[i], frame.Pix[i+2] = 0, 255
	}
	if _, err := encoder.encode(frame, 95); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, original) {
		t.Fatal("encoding a later frame mutated published JPEG bytes")
	}
	decoded, err := jpeg.Decode(bytes.NewReader(first))
	if err != nil {
		t.Fatal(err)
	}
	r, g, b, _ := decoded.At(32, 32).RGBA()
	if r < 60000 || g > 5000 || b > 5000 {
		t.Fatalf("RGBA red was not preserved: %d,%d,%d", r, g, b)
	}
	if decoded.Bounds().Dx() != 64 || decoded.Bounds().Dy() != 64 {
		t.Fatal("JPEG dimensions changed")
	}
}

func TestNALUPacketReuseAndFraming(t *testing.T) {
	buffer := make([]byte, 0, 64)
	avcc := packNALUs(buffer, [][]byte{{0x65, 1}, {}, {0x41, 2}}, false)
	if !bytes.Equal(avcc, []byte{0, 0, 0, 2, 0x65, 1, 0, 0, 0, 2, 0x41, 2}) {
		t.Fatalf("bad AVCC: %x", avcc)
	}
	annex := packNALUs(avcc, [][]byte{{0x65, 3}}, true)
	if &annex[0] != &avcc[0] {
		t.Fatal("packet backing storage not reused")
	}
	if !bytes.Equal(annex, []byte{0, 0, 0, 1, 0x65, 3}) {
		t.Fatalf("bad Annex-B: %x", annex)
	}
}
