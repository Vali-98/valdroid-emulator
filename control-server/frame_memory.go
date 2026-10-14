package main

import (
	"image"
	"sync"
	"unsafe"
)

// A decoded image has one owner: the JPEG worker, or the queue replacing it.
var rgbaFrames sync.Pool

func copyDecodedFrame(pixels unsafe.Pointer, width, height int) *image.RGBA {
	size := width * height * 4
	frame, _ := rgbaFrames.Get().(*image.RGBA)
	if frame == nil {
		frame = &image.RGBA{}
	}
	if cap(frame.Pix) < size {
		frame.Pix = make([]byte, size)
	}
	frame.Pix = frame.Pix[:size]
	frame.Stride, frame.Rect = width*4, image.Rect(0, 0, width, height)
	copy(frame.Pix, unsafe.Slice((*byte)(pixels), size))
	return frame
}

func releaseDecodedFrame(frame *image.RGBA) {
	if frame != nil && cap(frame.Pix) <= maxVideoPacket {
		rgbaFrames.Put(frame)
	}
}

func packNALUs(buffer []byte, nalus [][]byte, annexB bool) []byte {
	size := 0
	for _, nalu := range nalus {
		if len(nalu) != 0 {
			size += 4 + len(nalu)
		}
	}
	if cap(buffer) < size {
		buffer = make([]byte, 0, size)
	}
	buffer = buffer[:0]
	for _, nalu := range nalus {
		if len(nalu) == 0 {
			continue
		}
		if annexB {
			buffer = append(buffer, 0, 0, 0, 1)
		} else {
			buffer = append(buffer, byte(len(nalu)>>24), byte(len(nalu)>>16), byte(len(nalu)>>8), byte(len(nalu)))
		}
		buffer = append(buffer, nalu...)
	}
	return buffer
}
