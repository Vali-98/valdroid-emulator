//go:build darwin && cgo

package codec

/*
#cgo LDFLAGS: -framework VideoToolbox -framework CoreMedia -framework CoreVideo -framework CoreFoundation -framework Accelerate
#include <stdint.h>
#include <stdlib.h>

typedef struct VTDecoder VTDecoder;

VTDecoder* vt_decoder_create(const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size);
void vt_decoder_destroy(VTDecoder* decoder);
int vt_decoder_decode(VTDecoder* decoder, const uint8_t* data, size_t size, int64_t timestamp_us,
                      uint8_t** pixels, int* width, int* height);
void vt_decoder_free_buffer(uint8_t* buffer);
*/
import "C"

import (
	"errors"
	"image"
	"time"
	"unsafe"
)

type h264Decoder struct {
	decoder *C.VTDecoder
	packet  []byte
}

func newH264Decoder(sps, pps []byte, width, height int, orientation uint8) (*h264Decoder, error) {
	if len(sps) == 0 || len(pps) == 0 {
		return nil, errors.New("AVC sequence and picture parameter sets are required")
	}
	decoder := C.vt_decoder_create(
		(*C.uint8_t)(unsafe.Pointer(&sps[0])), C.size_t(len(sps)),
		(*C.uint8_t)(unsafe.Pointer(&pps[0])), C.size_t(len(pps)),
	)
	if decoder == nil {
		return nil, errors.New("VideoToolbox could not create an AVC decoder")
	}
	return &h264Decoder{decoder: decoder}, nil
}

func (d *h264Decoder) decode(nalus [][]byte, timestamp time.Duration) (*image.RGBA, error) {
	packet := packNALUs(d.packet, nalus, false)
	d.packet = packet
	if len(packet) == 0 {
		return nil, nil
	}

	var pixels *C.uint8_t
	var width, height C.int
	result := C.vt_decoder_decode(
		d.decoder,
		(*C.uint8_t)(unsafe.Pointer(&packet[0])),
		C.size_t(len(packet)),
		C.int64_t(timestamp/time.Microsecond),
		&pixels,
		&width,
		&height,
	)
	if result < 0 {
		return nil, errors.New("VideoToolbox failed to decode an AVC packet")
	}
	if result == 0 {
		return nil, nil
	}
	defer C.vt_decoder_free_buffer(pixels)

	return copyDecodedFrame(unsafe.Pointer(pixels), int(width), int(height)), nil
}

func (d *h264Decoder) close() {
	if d.decoder != nil {
		C.vt_decoder_destroy(d.decoder)
		d.decoder = nil
	}
}
