package server

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestAVCBroadcastSharesImmutablePacket(t *testing.T) {
	parser := &avcStreamParser{sps: []byte{0x67, 66, 0, 30}, pps: []byte{0x68, 2}}
	clients := []*avcClient{{display: 9001, samples: make(chan avcSample, 1)}, {display: 9001, samples: make(chan avcSample, 1)}}
	avcMu.Lock()
	for _, client := range clients {
		avcClients[client] = true
	}
	avcMu.Unlock()
	defer closeAVCClients()
	payload := []byte{0x65, 3}
	publishAVC(videoPacketHeader{displayID: 9001, presentationUS: 123456, frameNumber: 42}, parser, [][]byte{parser.sps, parser.pps, {0x09}, payload})
	a, b := <-clients[0].samples, <-clients[1].samples
	if &a.packet[0] != &b.packet[0] {
		t.Fatal("viewers must share the same immutable packet")
	}
	if string(a.packet[:4]) != "VDAV" || a.packet[4] != 1 || binary.LittleEndian.Uint64(a.packet[8:]) != 123456 || binary.LittleEndian.Uint32(a.packet[24:]) != 42 {
		t.Fatal("incorrect packet metadata")
	}
	expected := []byte{0, 0, 0, 1, 0x67, 66, 0, 30, 0, 0, 0, 1, 0x68, 2, 0, 0, 0, 1, 0x65, 3}
	if !bytes.Equal(a.packet[32:], expected) {
		t.Fatalf("incorrect Annex-B data: %x", a.packet[32:])
	}
	sps := bytes.Clone(a.sps)
	payload[1] = 99
	parser.updateParameterSets([][]byte{{0x67, 77, 0, 31}, {0x68, 3}})
	if !bytes.Equal(a.packet[32:], expected) || !bytes.Equal(a.sps, sps) {
		t.Fatal("queued frame changed after input/configuration reuse")
	}
}

func TestAgentVideoToWebSocketWaitsForKeyframes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(avcWebSocketHandler))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?display=9003", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	deadline := time.Now().Add(2 * time.Second)
	for {
		avcMu.Lock()
		subscribed := len(avcClients) > 0
		avcMu.Unlock()
		if subscribed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("viewer did not subscribe")
		}
		time.Sleep(time.Millisecond)
	}
	reader, writer := io.Pipe()
	finished := make(chan struct{})
	go func() { defer close(finished); handleVideo(bufio.NewReader(reader)) }()
	defer func() { writer.Close(); <-finished; reader.Close() }()
	codec := make([]byte, codecHeaderSize)
	copy(codec, "avc")
	if _, err := writer.Write(codec); err != nil {
		t.Fatal(err)
	}
	send := func(pts uint64, payload []byte) {
		t.Helper()
		var header [videoHeaderSize]byte
		binary.LittleEndian.PutUint32(header[0:], 9003)
		binary.LittleEndian.PutUint32(header[4:], 1080)
		binary.LittleEndian.PutUint32(header[8:], 2400)
		binary.LittleEndian.PutUint64(header[32:], pts)
		binary.LittleEndian.PutUint32(header[40:], uint32(len(payload)))
		if _, err := writer.Write(header[:]); err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(payload); err != nil {
			t.Fatal(err)
		}
	}
	read := func(kind int) []byte {
		t.Helper()
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		messageType, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if messageType != kind {
			t.Fatalf("message type %d, want %d", messageType, kind)
		}
		return data
	}
	send(0, []byte{0, 0, 0, 1, 0x67, 66, 0, 30, 0, 0, 0, 1, 0x68, 2})
	send(100, []byte{0, 0, 0, 1, 0x41, 1})
	read(websocket.TextMessage)
	send(200, []byte{0, 0, 0, 1, 0x65, 2})
	if packet := read(websocket.BinaryMessage); packet[4] != 1 || binary.LittleEndian.Uint64(packet[8:]) != 200 {
		t.Fatal("stream did not start at keyframe")
	}
	send(300, []byte{0, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x41, 3})
	read(websocket.TextMessage)
	send(400, []byte{0, 0, 0, 1, 0x65, 4})
	if packet := read(websocket.BinaryMessage); packet[4] != 1 || binary.LittleEndian.Uint64(packet[8:]) != 400 {
		t.Fatal("configuration change did not wait for keyframe")
	}
}

func TestAVCSlowViewerDisconnectsWithoutDroppingReferences(t *testing.T) {
	client := &avcClient{display: 9002, samples: make(chan avcSample, 1)}
	avcMu.Lock()
	avcClients[client] = true
	avcMu.Unlock()
	defer closeAVCClients()
	parser := &avcStreamParser{sps: []byte{0x67, 66, 0, 30}, pps: []byte{0x68, 2}}
	header := videoPacketHeader{displayID: 9002}
	publishAVC(header, parser, [][]byte{{0x65, 1}})
	publishAVC(header, parser, [][]byte{{0x41, 2}})
	first := <-client.samples
	if !first.key {
		t.Fatal("queued reference frame was replaced")
	}
	if _, open := <-client.samples; open {
		t.Fatal("slow client remained connected")
	}
}

func TestDisplayQueryValidation(t *testing.T) {
	for _, value := range []string{"-1", "oops", "2147483648"} {
		if _, err := requestedDisplay(httptest.NewRequest("GET", "/avc?display="+value, nil)); err == nil {
			t.Errorf("accepted invalid display %q", value)
		}
	}
}
