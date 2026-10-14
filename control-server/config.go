package main

import "time"

const (
	SOCKET_ADDR           = ":5050"
	HTTP_ADDR             = ":8080"
	BOUNDARY              = "frame"
	videoHeaderSize       = 44
	codecHeaderSize       = 20
	maxVideoPacket        = 64 * 1024 * 1024
	primaryDisplayID      = 0
	adbStartupTimeout     = 90 * time.Second
	agentChannelTimeout   = 60 * time.Second
	agentLogTailMaxLength = 6000
)
