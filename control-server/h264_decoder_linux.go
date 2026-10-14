//go:build linux && cgo

package main

/*
#cgo linux pkg-config: libavcodec libavutil libswscale
#include <stdint.h>
#include <stdlib.h>

typedef struct LinuxDecoder LinuxDecoder;

LinuxDecoder* linux_decoder_create(const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size);
void linux_decoder_destroy(LinuxDecoder* decoder);
int linux_decoder_decode(LinuxDecoder* decoder, const uint8_t* data, size_t size, int64_t timestamp_us,
                         uint8_t** pixels, int* width, int* height);
void linux_decoder_free_buffer(uint8_t* buffer);
*/
import "C"

import (
	"errors"
	"image"
	"time"
	"unsafe"
)

type h264Decoder struct {
	decoder *C.LinuxDecoder
}

func newH264Decoder(sps, pps []byte, width, height int, orientation uint8) (*h264Decoder, error) {
	if len(sps) == 0 || len(pps) == 0 {
		return nil, errors.New("AVC sequence and picture parameter sets are required")
	}
	decoder := C.linux_decoder_create(
		(*C.uint8_t)(unsafe.Pointer(&sps[0])), C.size_t(len(sps)),
		(*C.uint8_t)(unsafe.Pointer(&pps[0])), C.size_t(len(pps)),
	)
	if decoder == nil {
		return nil, errors.New("libavcodec could not create an AVC decoder")
	}
	return &h264Decoder{decoder: decoder}, nil
}

func (d *h264Decoder) decode(nalus [][]byte, timestamp time.Duration) (*image.RGBA, error) {
	var packet []byte
	for _, nalu := range nalus {
		if len(nalu) == 0 {
			continue
		}
		packet = append(packet, 0, 0, 0, 1)
		packet = append(packet, nalu...)
	}
	if len(packet) == 0 {
		return nil, nil
	}

	packetMemory := C.CBytes(packet)
	defer C.free(packetMemory)
	var pixels *C.uint8_t
	var width, height C.int
	result := C.linux_decoder_decode(
		d.decoder,
		(*C.uint8_t)(packetMemory),
		C.size_t(len(packet)),
		C.int64_t(timestamp/time.Microsecond),
		&pixels,
		&width,
		&height,
	)
	if result < 0 {
		return nil, errors.New("libavcodec failed to decode an AVC packet")
	}
	if result == 0 {
		return nil, nil
	}
	defer C.linux_decoder_free_buffer(pixels)

	frameWidth, frameHeight := int(width), int(height)
	pixelBytes := C.GoBytes(unsafe.Pointer(pixels), C.int(frameWidth*frameHeight*4))
	return &image.RGBA{
		Pix:    pixelBytes,
		Stride: frameWidth * 4,
		Rect:   image.Rect(0, 0, frameWidth, frameHeight),
	}, nil
}

func (d *h264Decoder) close() {
	if d.decoder != nil {
		C.linux_decoder_destroy(d.decoder)
		d.decoder = nil
	}
}