package server

import (
	"bufio"
	"io"
	"log"
	"strings"
	"sync/atomic"
)

var (
	videoPacketCount atomic.Uint64
	lastVideoPTS     atomic.Int64
)

func handleVideo(reader *bufio.Reader) {
	defer closeAVCClients()
	defer log.Printf("Agent video reader stopped")
	codecHeader := make([]byte, codecHeaderSize)
	if _, err := io.ReadFull(reader, codecHeader); err != nil {
		log.Printf("Video codec header read failed: %v", err)
		return
	}
	codecName := strings.TrimRight(string(codecHeader), "\x00 ")
	if codecName != "avc" {
		log.Printf("Unsupported agent video codec %q; this server forwards AVC", codecName)
		return
	}
	log.Printf("Agent video codec: %s", codecName)

	parsers := make(map[int32]*avcStreamParser)

	var encodedHeader [videoHeaderSize]byte
	var payload []byte
	for {
		if _, err := io.ReadFull(reader, encodedHeader[:]); err != nil {
			if err != io.EOF {
				log.Printf("Video packet header read failed: %v", err)
			}
			return
		}
		header, err := parseVideoPacketHeader(encodedHeader[:])
		if err != nil {
			log.Printf("Invalid video packet header: %v", err)
			return
		}
		if header.packetSize < 0 || header.packetSize > maxVideoPacket {
			log.Printf("Invalid video packet size %d", header.packetSize)
			return
		}
		videoPacketCount.Add(1)
		if header.presentationUS != 0 {
			lastVideoPTS.Store(header.presentationUS)
		}
		if header.packetSize == 0 {
			continue
		}

		if cap(payload) < int(header.packetSize) {
			payload = make([]byte, int(header.packetSize))
		}
		payload = payload[:int(header.packetSize)]
		if _, err := io.ReadFull(reader, payload); err != nil {
			log.Printf("Incomplete video packet (%d bytes): %v", header.packetSize, err)
			return
		}
		parser := parsers[header.displayID]
		if parser == nil {
			parser = &avcStreamParser{lengthSize: 4}
			parsers[header.displayID] = parser
		}
		nalus, _, err := parser.parse(payload)
		if err != nil {
			log.Printf("Invalid AVC payload: %v", err)
			return
		}
		if header.presentationUS == 0 || !hasVideoNALU(nalus) {
			continue
		}
		if len(parser.sps) == 0 || len(parser.pps) == 0 {
			log.Printf("Video frame arrived before AVC SPS/PPS configuration")
			continue
		}
		publishAVC(header, parser, nalus)
	}
}
