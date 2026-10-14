package main

import (
	"bufio"
	"errors"
	"log"
	"net"
	"sync"
)

var (
	channelStatusMu sync.RWMutex
	videoChannels   int
	audioChannels   int
)

func startTCP(listener net.Listener) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			log.Printf("Agent socket accept failed: %v", err)
			continue
		}
		go handleConn(conn)
	}
}

func agentChannelsReady() (bool, bool, bool) {
	channelStatusMu.RLock()
	videoReady := videoChannels > 0
	audioReady := audioChannels > 0
	channelStatusMu.RUnlock()
	agentControlMu.Lock()
	controlReady := agentControl != nil
	agentControlMu.Unlock()
	return videoReady, audioReady, controlReady
}

func handleConn(conn net.Conn) {
	defer conn.Close()
	reader := bufio.NewReader(conn)
	marker, err := reader.ReadByte()
	if err != nil {
		return
	}
	if marker == 'V' || marker == 'A' || marker == 'C' {
		trackAgentChannel(marker, 1)
		defer trackAgentChannel(marker, -1)
	}

	switch marker {
	case 'V':
		log.Printf("Agent video channel connected from %s", conn.RemoteAddr())
		handleVideo(reader)
	case 'A':
		log.Printf("Agent audio channel connected from %s", conn.RemoteAddr())
		handleAudio(reader)
	case 'C':
		log.Printf("Agent control channel connected from %s", conn.RemoteAddr())
		handleControl(conn, reader)
	default:
		log.Printf("Unknown agent channel marker %q from %s", marker, conn.RemoteAddr())
	}
}

func trackAgentChannel(marker byte, delta int) {
	channelStatusMu.Lock()
	switch marker {
	case 'V':
		videoChannels += delta
	case 'A':
		audioChannels += delta
	}
	channelStatusMu.Unlock()
}
