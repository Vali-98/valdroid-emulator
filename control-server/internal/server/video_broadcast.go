package server

import (
	"bytes"
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

const avcBootstrapFrames = 96
const avcBootstrapBytes = 12 * 1024 * 1024

type avcBootstrap struct {
	samples []avcSample
	bytes   int
}

var avcBootstraps = make(map[int32]avcBootstrap)

func subscribeAVC(display int32) *avcClient {
	avcMu.Lock()
	defer avcMu.Unlock()
	bootstrap := avcBootstraps[display]
	client := &avcClient{display: display, samples: make(chan avcSample, len(bootstrap.samples)+8)}
	for _, sample := range bootstrap.samples {
		client.samples <- sample
	}
	avcClients[client] = true
	return client
}

// Build one immutable Annex-B packet for every viewer of this display.
// Parser parameter sets are replaced on changes, never mutated in place.
func publishAVC(header videoPacketHeader, parser *avcStreamParser, nalus [][]byte) {
	displayStateMu.Lock()
	displayStates[header.displayID] = displayState{header.displayID, header.displayWidth, header.displayHeight, header.orientation, header.orientationFix}
	displayStateMu.Unlock()
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
	bootstrap := avcBootstraps[header.displayID]
	if len(bootstrap.samples) > 0 {
		last := bootstrap.samples[len(bootstrap.samples)-1]
		if !bytes.Equal(last.sps, sample.sps) || !bytes.Equal(last.pps, sample.pps) || last.header.displayWidth != header.displayWidth || last.header.displayHeight != header.displayHeight || last.header.orientation != header.orientation || last.header.orientationFix != header.orientationFix {
			bootstrap = avcBootstrap{}
		}
	}
	if sample.key {
		bootstrap = avcBootstrap{}
	}
	if sample.key || len(bootstrap.samples) > 0 {
		if len(bootstrap.samples) < avcBootstrapFrames && bootstrap.bytes+len(sample.packet) <= avcBootstrapBytes && len(sample.sps) >= 4 && len(sample.pps) > 0 {
			bootstrap.samples = append(bootstrap.samples, sample)
			bootstrap.bytes += len(sample.packet)
		} else {
			bootstrap = avcBootstrap{}
		} // Never seed an incomplete reference chain.
	}
	_, cached := avcBootstraps[header.displayID]
	if len(avcBootstraps) < 8 || cached {
		avcBootstraps[header.displayID] = bootstrap
	}
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
	avcBootstraps = make(map[int32]avcBootstrap)
	for client := range avcClients {
		close(client.samples)
		delete(avcClients, client)
	}
}
