package codec

import (
	"image"
	"testing"
	"unsafe"
)

func TestDecodedFrameCopyOwnsPixelsAndResetsDimensions(t *testing.T) {
	pixels := []byte{255, 10, 20, 255, 20, 255, 10, 255}
	frame := copyDecodedFrame(unsafe.Pointer(&pixels[0]), 2, 1)
	pixels[0] = 0
	if frame.Pix[0] != 255 || frame.Stride != 8 {
		t.Fatal("frame aliases native pixels or has an invalid stride")
	}
	ReleaseFrame(frame)
	frame = copyDecodedFrame(unsafe.Pointer(&pixels[0]), 1, 2)
	defer ReleaseFrame(frame)
	if frame.Rect != image.Rect(0, 0, 1, 2) || frame.Stride != 4 || len(frame.Pix) != 8 || frame.Pix[0] != 0 {
		t.Fatalf("reused frame retained stale data or dimensions: %+v", frame)
	}
}
