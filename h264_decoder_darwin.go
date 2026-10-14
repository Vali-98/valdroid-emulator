//go:build darwin && cgo

package main

/*
#cgo LDFLAGS: -framework VideoToolbox -framework CoreMedia -framework CoreVideo -framework CoreFoundation
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
	var packet []byte
	for _, nalu := range nalus {
		if len(nalu) == 0 {
			continue
		}
		packet = append(packet, byte(len(nalu)>>24), byte(len(nalu)>>16), byte(len(nalu)>>8), byte(len(nalu)))
		packet = append(packet, nalu...)
	}
	if len(packet) == 0 {
		return nil, nil
	}

	packetMemory := C.CBytes(packet)
	defer C.free(packetMemory)

	var pixels *C.uint8_t
	var width, height C.int
	result := C.vt_decoder_decode(
		d.decoder,
		(*C.uint8_t)(packetMemory),
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

	frameWidth, frameHeight := int(width), int(height)
	bgra := C.GoBytes(unsafe.Pointer(pixels), C.int(frameWidth*frameHeight*4))
	frame := image.NewRGBA(image.Rect(0, 0, frameWidth, frameHeight))
	for y := 0; y < frameHeight; y++ {
		for x := 0; x < frameWidth; x++ {
			source := (y*frameWidth + x) * 4
			destination := y*frame.Stride + x*4
			frame.Pix[destination] = bgra[source+2]
			frame.Pix[destination+1] = bgra[source+1]
			frame.Pix[destination+2] = bgra[source]
			frame.Pix[destination+3] = bgra[source+3]
		}
	}
	return frame, nil
}

func (d *h264Decoder) close() {
	if d.decoder != nil {
		C.vt_decoder_destroy(d.decoder)
		d.decoder = nil
	}
}
