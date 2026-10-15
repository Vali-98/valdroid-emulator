package server

var jpegQuality = 95

const (
	SOCKET_ADDR      = "127.0.0.1:38476"
	HTTP_ADDR        = "127.0.0.1:38475"
	BOUNDARY         = "frame"
	videoHeaderSize  = 44
	codecHeaderSize  = 20
	maxVideoPacket   = 64 * 1024 * 1024
	primaryDisplayID = 0
)
