package main

import "image"

type jpegEncoder interface {
	encode(*image.RGBA, int) ([]byte, error)
	close()
}

var jpegQuality = 95
