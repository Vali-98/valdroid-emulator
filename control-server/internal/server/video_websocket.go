package server

import (
	"encoding/binary"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const jpegFrameHeaderSize = 40

func subscribeFrames(displayID int32) (*streamClient, func()) {
	client := &streamClient{displayID: displayID, frames: make(chan streamFrame, 1)}
	clientsMu.Lock()
	clients[client] = struct{}{}
	if frame, exists := latestFrames[displayID]; exists {
		frame.cached = true
		client.frames <- frame
	}
	clientsMu.Unlock()
	return client, func() {
		clientsMu.Lock()
		delete(clients, client)
		clientsMu.Unlock()
	}
}

func jpegFrameHeader(frame streamFrame) [jpegFrameHeaderSize]byte {
	var header [jpegFrameHeaderSize]byte
	copy(header[:4], "VDJP")
	binary.LittleEndian.PutUint32(header[4:8], uint32(frame.displayID))
	binary.LittleEndian.PutUint32(header[8:12], uint32(frame.displayWidth))
	binary.LittleEndian.PutUint32(header[12:16], uint32(frame.displayHeight))
	binary.LittleEndian.PutUint32(header[16:20], uint32(frame.orientation))
	binary.LittleEndian.PutUint32(header[20:24], frame.frameNumber)
	binary.LittleEndian.PutUint64(header[24:32], uint64(frame.presentationUS))
	if !frame.cached && !frame.receivedAt.IsZero() {
		binary.LittleEndian.PutUint64(header[32:40], uint64(time.Since(frame.receivedAt).Microseconds()))
	}
	return header
}

func videoWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	displayID, err := requestedDisplay(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	connection, err := websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	connection.SetReadLimit(1024)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		for {
			if _, _, err := connection.ReadMessage(); err != nil {
				return
			}
		}
	}()
	defer func() { _ = connection.Close(); <-readerDone }()
	client, unsubscribe := subscribeFrames(displayID)
	defer unsubscribe()
	metrics := metricsFor(displayID)
	for {
		select {
		case <-r.Context().Done():
			return
		case <-readerDone:
			return
		case frame := <-client.frames:
			started := time.Now()
			_ = connection.SetWriteDeadline(started.Add(250 * time.Millisecond))
			writer, err := connection.NextWriter(websocket.BinaryMessage)
			if err != nil {
				return
			}
			header := jpegFrameHeader(frame)
			if _, err = writer.Write(header[:]); err == nil {
				_, err = writer.Write(frame.jpeg)
			}
			closeErr := writer.Close()
			if err != nil || closeErr != nil {
				return
			}
			metrics.mu.Lock()
			metrics.delivered++
			metrics.writes.add(time.Since(started))
			if !frame.cached && !frame.receivedAt.IsZero() {
				metrics.residence.add(time.Since(frame.receivedAt))
			}
			metrics.mu.Unlock()
		}
	}
}
