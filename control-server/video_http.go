package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"
)

type streamFrame struct {
	displayID      int32
	displayWidth   int32
	displayHeight  int32
	orientation    uint8
	presentationUS int64
	jpeg           []byte
	receivedAt     time.Time
	frameNumber    uint32
	cached         bool
}

type displayState struct {
	ID          int32 `json:"id"`
	Width       int32 `json:"width"`
	Height      int32 `json:"height"`
	Orientation uint8 `json:"orientation"`
}

type streamClient struct {
	displayID int32
	frames    chan streamFrame
}

var (
	clients        = make(map[*streamClient]struct{})
	clientsMu      sync.Mutex
	latestFrames   = make(map[int32]streamFrame)
	displayStates  = make(map[int32]displayState)
	displayStateMu sync.RWMutex
)

func requestedDisplay(r *http.Request) (int32, error) {
	displayID := int32(primaryDisplayID)
	if value := r.URL.Query().Get("display"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 32)
		if err != nil || parsed < 0 {
			return 0, errors.New("invalid display id")
		}
		displayID = int32(parsed)
	}
	return displayID, nil
}

func displayStateHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	displayID, err := requestedDisplay(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	displayStateMu.RLock()
	state, exists := displayStates[displayID]
	displayStateMu.RUnlock()
	if !exists {
		http.Error(w, "display metadata is not available yet", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(state)
}

func broadcast(frame streamFrame) {
	displayStateMu.Lock()
	displayStates[frame.displayID] = displayState{
		ID:          frame.displayID,
		Width:       frame.displayWidth,
		Height:      frame.displayHeight,
		Orientation: frame.orientation,
	}
	displayStateMu.Unlock()

	clientsMu.Lock()
	defer clientsMu.Unlock()
	latestFrames[frame.displayID] = frame
	for client := range clients {
		if client.displayID != frame.displayID {
			continue
		}
		select {
		case client.frames <- frame:
		default:
			select {
			case <-client.frames:
				metrics := metricsFor(frame.displayID)
				metrics.mu.Lock()
				metrics.clientDrops++
				metrics.mu.Unlock()
			default:
			}
			select {
			case client.frames <- frame:
			default:
			}
		}
	}
}

func mjpegHandler(w http.ResponseWriter, r *http.Request) {
	displayID, err := requestedDisplay(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+BOUNDARY)
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("X-Accel-Buffering", "no")

	_, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is not supported", http.StatusInternalServerError)
		return
	}
	client := &streamClient{displayID: displayID, frames: make(chan streamFrame, 1)}
	clientsMu.Lock()
	clients[client] = struct{}{}
	if frame, exists := latestFrames[displayID]; exists {
		frame.cached = true
		client.frames <- frame
	}
	clientsMu.Unlock()
	defer func() {
		clientsMu.Lock()
		delete(clients, client)
		clientsMu.Unlock()
	}()

	log.Printf("MJPEG client connected for display %d", displayID)
	controller := http.NewResponseController(w)
	header := make([]byte, 0, 384)
	metrics := metricsFor(displayID)
	for {
		select {
		case <-r.Context().Done():
			return
		case frame := <-client.frames:
			started := time.Now()
			_ = controller.SetWriteDeadline(started.Add(2 * time.Second))
			header = appendFrameHeader(header[:0], frame)
			if _, err := w.Write(header); err != nil {
				return
			}
			if _, err := w.Write(frame.jpeg); err != nil {
				return
			}
			if _, err := io.WriteString(w, "\r\n"); err != nil {
				return
			}
			if err := controller.Flush(); err != nil {
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

func appendFrameHeader(buffer []byte, frame streamFrame) []byte {
	buffer = append(buffer, "--"+BOUNDARY+"\r\nContent-Type: image/jpeg\r\nContent-Length: "...)
	buffer = strconv.AppendInt(buffer, int64(len(frame.jpeg)), 10)
	for _, field := range []struct {
		name  string
		value int64
	}{
		{"X-Display-ID", int64(frame.displayID)}, {"X-Display-Width", int64(frame.displayWidth)},
		{"X-Display-Height", int64(frame.displayHeight)}, {"X-Display-Orientation", int64(frame.orientation)},
		{"X-Presentation-Timestamp-Us", frame.presentationUS}, {"X-Frame-Number", int64(frame.frameNumber)},
	} {
		buffer = append(buffer, "\r\n"...)
		buffer = append(buffer, field.name...)
		buffer = append(buffer, ": "...)
		buffer = strconv.AppendInt(buffer, field.value, 10)
	}
	if !frame.cached && !frame.receivedAt.IsZero() {
		buffer = append(buffer, "\r\nX-Server-Processing-Us: "...)
		buffer = strconv.AppendInt(buffer, time.Since(frame.receivedAt).Microseconds(), 10)
	}
	return append(buffer, "\r\n\r\n"...)
}
