package server

import (
	"encoding/binary"
	"log"
	"sync"
	"time"
)

type avcSample struct {
	header           videoPacketHeader
	sps, pps, packet []byte
	key              bool
	receivedAt       time.Time
}

type avcClient struct {
	display int32
	samples chan avcSample
}

var avcMu sync.Mutex
var avcClients = make(map[*avcClient]bool)

// Build one immutable Annex-B packet for every viewer of this display.
// Parser parameter sets are replaced on changes, never mutated in place.
func publishAVC(header videoPacketHeader, parser *avcStreamParser, nalus [][]byte) {
	displayStateMu.Lock()
	displayStates[header.displayID] = displayState{header.displayID, header.displayWidth, header.displayHeight, header.orientation}
	displayStateMu.Unlock()
	avcMu.Lock()
	interested := false
	for client := range avcClients {
		if client.display == header.displayID {
			interested = true
			break
		}
	}
	avcMu.Unlock()
	if !interested {
		return
	}
	sample := avcSample{header: header, sps: parser.sps, pps: parser.pps, receivedAt: time.Now()}
	size := 32
	for _, nalu := range nalus {
		if !forwardNAL(nalu) {
			continue
		}
		sample.key = sample.key || nalu[0]&31 == 5
		size += 4 + len(nalu)
	}
	if sample.key {
		size += 8 + len(sample.sps) + len(sample.pps)
	}
	sample.packet = make([]byte, 32, size)
	writeAVCHeader(sample.packet, sample)
	appendNAL := func(nalu []byte) {
		sample.packet = binary.BigEndian.AppendUint32(sample.packet, 1)
		sample.packet = append(sample.packet, nalu...)
	}
	if sample.key {
		appendNAL(sample.sps)
		appendNAL(sample.pps)
	}
	for _, nalu := range nalus {
		if forwardNAL(nalu) {
			appendNAL(nalu)
		}
	}
	avcMu.Lock()
	defer avcMu.Unlock()
	for client := range avcClients {
		if client.display != header.displayID {
			continue
		}
		select {
		case client.samples <- sample:
		default:
			// AVC frames depend on preceding frames; disconnect rather than drop references.
			close(client.samples)
			delete(avcClients, client)
			log.Printf("AVC display %d: disconnecting slow viewer", client.display)
		}
	}
}

func forwardNAL(nalu []byte) bool {
	if len(nalu) == 0 {
		return false
	}
	kind := nalu[0] & 31
	return kind != 7 && kind != 8 && kind != 9
}

func closeAVCClients() {
	avcMu.Lock()
	defer avcMu.Unlock()
	for client := range avcClients {
		close(client.samples)
		delete(avcClients, client)
	}
}
