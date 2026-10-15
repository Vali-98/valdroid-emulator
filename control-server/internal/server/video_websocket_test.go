package server

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestIdleVideoWebSocketClosesOnServerContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		videoWebSocketHandler(w, r.WithContext(ctx))
	}))
	defer server.Close()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?display=90106", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	cancel()
	_ = connection.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := connection.ReadMessage(); err == nil {
		t.Fatal("idle video connection survived shutdown")
	}
}

func TestVideoWebSocketEnvelopeAndCachedFrame(t *testing.T) {
	const display = 90105
	broadcast(streamFrame{displayID: display, displayWidth: 1080, displayHeight: 2400, orientation: 1, frameNumber: 42, presentationUS: 123456, jpeg: []byte{0xff, 0xd8, 0xff, 0xd9}, receivedAt: time.Now()})
	defer func() { clientsMu.Lock(); delete(latestFrames, display); clientsMu.Unlock() }()
	server := httptest.NewServer(http.HandlerFunc(videoWebSocketHandler))
	defer server.Close()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?display=90105", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_ = connection.SetReadDeadline(time.Now().Add(time.Second))
	kind, data, err := connection.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage || len(data) != 44 || string(data[:4]) != "VDJP" {
		t.Fatalf("invalid frame: %x, %v", data, err)
	}
	if binary.LittleEndian.Uint32(data[8:12]) != 1080 || binary.LittleEndian.Uint32(data[20:24]) != 42 || binary.LittleEndian.Uint64(data[24:32]) != 123456 || binary.LittleEndian.Uint64(data[32:40]) != 0 {
		t.Fatalf("invalid metadata: %x", data[:40])
	}
}

func TestControlAcknowledgementEndsAfterAgentWrite(t *testing.T) {
	agent, receiver := net.Pipe()
	defer agent.Close()
	defer receiver.Close()
	agentControlMu.Lock()
	previous := agentControl
	agentControl = agent
	agentControlMu.Unlock()
	defer func() { agentControlMu.Lock(); agentControl = previous; agentControlMu.Unlock() }()
	server := httptest.NewServer(http.HandlerFunc(controlWebSocketHandler))
	defer server.Close()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	command := inputCommand{Type: "key", Action: 0, KeyCode: 3, RequestID: "probe-1"}
	if err := connection.WriteJSON(command); err != nil {
		t.Fatal(err)
	}
	wire, _ := encodeInputCommand(command)
	_ = receiver.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := io.ReadFull(receiver, make([]byte, len(wire))); err != nil {
		t.Fatal(err)
	}
	_ = connection.SetReadDeadline(time.Now().Add(time.Second))
	_, reply, err := connection.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Type, RequestID string
		ServerForwardUS int64
	}
	if err := json.Unmarshal(reply, &result); err != nil || result.Type != "input-ack" || result.RequestID != "probe-1" || result.ServerForwardUS < 0 {
		t.Fatalf("unexpected ack: %s", reply)
	}
}
