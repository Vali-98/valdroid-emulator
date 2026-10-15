//go:build darwin && cgo && !turbojpeg

package codec

/*
#cgo LDFLAGS: -framework ImageIO -framework CoreGraphics -framework CoreFoundation
#include <stdint.h>
void* encode_imageio_jpeg(const uint8_t* pixels, int width, int height, int stride, double quality);
const uint8_t* imageio_jpeg_bytes(void* data);
long imageio_jpeg_size(void* data);
void imageio_jpeg_free(void* data);
*/
import "C"

import (
	"errors"
	"image"
	"runtime"
	"unsafe"
)

const jpegEncoderName = "macOS ImageIO"

type imageIOJPEGEncoder struct{}

func newJPEGEncoder() (jpegEncoder, error) { return &imageIOJPEGEncoder{}, nil }
func (e *imageIOJPEGEncoder) encode(frame *image.RGBA, quality int) ([]byte, error) {
	if frame.Rect.Empty() {
		return nil, errors.New("empty JPEG frame")
	}
	data := C.encode_imageio_jpeg((*C.uint8_t)(unsafe.Pointer(&frame.Pix[0])), C.int(frame.Rect.Dx()), C.int(frame.Rect.Dy()), C.int(frame.Stride), C.double(float64(quality)/100))
	runtime.KeepAlive(frame)
	if data == nil {
		return nil, errors.New("ImageIO failed to encode JPEG")
	}
	defer C.imageio_jpeg_free(data)
	return C.GoBytes(unsafe.Pointer(C.imageio_jpeg_bytes(data)), C.int(C.imageio_jpeg_size(data))), nil
}
func (e *imageIOJPEGEncoder) close() {}
