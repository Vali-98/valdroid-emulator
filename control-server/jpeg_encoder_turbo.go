//go:build cgo && turbojpeg

package main

/*
#cgo pkg-config: libturbojpeg
#include <turbojpeg.h>
*/
import "C"

import (
	"errors"
	"image"
	"runtime"
	"unsafe"
)

const jpegEncoderName = "libjpeg-turbo"

type turboJPEGEncoder struct {
	handle   C.tjhandle
	output   *C.uchar
	capacity C.ulong
}

func newJPEGEncoder() (jpegEncoder, error) {
	handle := C.tjInitCompress()
	if handle == nil {
		return nil, errors.New("could not initialize libjpeg-turbo")
	}
	return &turboJPEGEncoder{handle: handle}, nil
}
func (e *turboJPEGEncoder) encode(frame *image.RGBA, quality int) ([]byte, error) {
	if frame.Rect.Empty() {
		return nil, errors.New("empty JPEG frame")
	}
	size := C.tjBufSize(C.int(frame.Rect.Dx()), C.int(frame.Rect.Dy()), C.TJSAMP_420)
	if size > e.capacity {
		if e.output != nil {
			C.tjFree(e.output)
		}
		e.output = C.tjAlloc(C.int(size))
		if e.output == nil {
			e.capacity = 0
			return nil, errors.New("could not allocate JPEG buffer")
		}
		e.capacity = size
	}
	written := e.capacity
	result := C.tjCompress2(e.handle, (*C.uchar)(unsafe.Pointer(&frame.Pix[0])), C.int(frame.Rect.Dx()), C.int(frame.Stride), C.int(frame.Rect.Dy()), C.TJPF_RGBA,
		&e.output, &written, C.TJSAMP_420, C.int(quality), C.TJFLAG_FASTDCT|C.TJFLAG_NOREALLOC)
	runtime.KeepAlive(frame)
	if result != 0 {
		return nil, errors.New(C.GoString(C.tjGetErrorStr2(e.handle)))
	}
	return C.GoBytes(unsafe.Pointer(e.output), C.int(written)), nil
}
func (e *turboJPEGEncoder) close() {
	if e.output != nil {
		C.tjFree(e.output)
	}
	C.tjDestroy(e.handle)
}
