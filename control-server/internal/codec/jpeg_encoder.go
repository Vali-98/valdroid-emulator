package codec

import "image"

type jpegEncoder interface {
	encode(*image.RGBA, int) ([]byte, error)
	close()
}
