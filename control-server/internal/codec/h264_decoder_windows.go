//go:build windows && cgo

package codec

/*
#cgo windows LDFLAGS: -lmfplat -lmfuuid -lole32
#include <stdint.h>
#include <stdlib.h>

typedef struct MFDecoder MFDecoder;

MFDecoder* mf_decoder_create(const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size,
                             int width, int height);
void mf_decoder_destroy(MFDecoder* decoder);
int mf_decoder_decode(MFDecoder* decoder, const uint8_t* data, size_t size, int64_t timestamp_us,
                      uint8_t** pixels, int* width, int* height);
void mf_decoder_free_buffer(uint8_t* buffer);
*/
import "C"

import (
	"errors"
	"image"
	"runtime"
	"time"
	"unsafe"
)

type h264Decoder struct {
	decoder      *C.MFDecoder
	threadLocked bool
	packet       []byte
}

func newH264Decoder(sps, pps []byte, width, height int, orientation uint8) (*h264Decoder, error) {
	if len(sps) == 0 || len(pps) == 0 || width <= 0 || height <= 0 {
		return nil, errors.New("AVC parameter sets and display dimensions are required")
	}
	runtime.LockOSThread()
	if orientation&1 != 0 {
		width, height = height, width
	}
	decoder := C.mf_decoder_create(
		(*C.uint8_t)(unsafe.Pointer(&sps[0])), C.size_t(len(sps)),
		(*C.uint8_t)(unsafe.Pointer(&pps[0])), C.size_t(len(pps)),
		C.int(width), C.int(height),
	)
	if decoder == nil {
		runtime.UnlockOSThread()
		return nil, errors.New("Windows Media Foundation could not create an AVC decoder")
	}
	return &h264Decoder{decoder: decoder, threadLocked: true}, nil
}

func (d *h264Decoder) decode(nalus [][]byte, timestamp time.Duration) (*image.RGBA, error) {
	packet := packNALUs(d.packet, nalus, true)
	d.packet = packet
	if len(packet) == 0 {
		return nil, nil
	}

	var pixels *C.uint8_t
	var width, height C.int
	result := C.mf_decoder_decode(
		d.decoder,
		(*C.uint8_t)(unsafe.Pointer(&packet[0])),
		C.size_t(len(packet)),
		C.int64_t(timestamp/time.Microsecond),
		&pixels,
		&width,
		&height,
	)
	if result < 0 {
		return nil, errors.New("Windows Media Foundation failed to decode an AVC packet")
	}
	if result == 0 {
		return nil, nil
	}
	defer C.mf_decoder_free_buffer(pixels)

	return copyDecodedFrame(unsafe.Pointer(pixels), int(width), int(height)), nil
}

func (d *h264Decoder) close() {
	if d.decoder != nil {
		C.mf_decoder_destroy(d.decoder)
		d.decoder = nil
	}
	if d.threadLocked {
		runtime.UnlockOSThread()
		d.threadLocked = false
	}
}
