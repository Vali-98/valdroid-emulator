package server

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// Direct AVC: immutable access units from the agent, without remuxing or decoding.
// Binary messages: 32-byte LE header (VDAV, key flag, PTS us, server receipt
// Unix ms, frame number, reserved), followed by Annex-B NAL units.
func writeAVCHeader(packet []byte, sample avcSample) {
	copy(packet, "VDAV")
	if sample.key {
		packet[4] = 1
	}
	binary.LittleEndian.PutUint64(packet[8:], uint64(sample.header.presentationUS))
	binary.LittleEndian.PutUint64(packet[16:], uint64(sample.receivedAt.UnixMilli()))
	binary.LittleEndian.PutUint32(packet[24:], sample.header.frameNumber)
}

func avcWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	display, err := requestedDisplay(r)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	conn, err := websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(1024)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	defer func() { _ = conn.Close(); <-done }()
	client := subscribeAVC(display)
	defer func() { avcMu.Lock(); delete(avcClients, client); avcMu.Unlock() }()
	var previous *avcSample
	waitingKey := true
	for {
		select {
		case <-done:
			return
		case <-r.Context().Done():
			return
		case sample, ok := <-client.samples:
			if !ok {
				return
			}
			if len(sample.sps) < 4 || len(sample.pps) == 0 {
				continue
			}
			changed := previous == nil || !bytes.Equal(sample.sps, previous.sps) || !bytes.Equal(sample.pps, previous.pps) || sample.header.displayWidth != previous.header.displayWidth || sample.header.displayHeight != previous.header.displayHeight || sample.header.orientation != previous.header.orientation || sample.header.orientationFix != previous.header.orientationFix
			_ = conn.SetWriteDeadline(time.Now().Add(250 * time.Millisecond))
			if changed {
				waitingKey = true
				if err := conn.WriteJSON(map[string]any{"type": "config", "codec": fmt.Sprintf("avc1.%02X%02X%02X", sample.sps[1], sample.sps[2], sample.sps[3]), "display": displayState{sample.header.displayID, sample.header.displayWidth, sample.header.displayHeight, sample.header.orientation, sample.header.orientationFix}}); err != nil {
					return
				}
			}
			previous = &sample
			if waitingKey && !sample.key {
				continue
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, sample.packet); err != nil {
				return
			}
			waitingKey = false
		}
	}
}
