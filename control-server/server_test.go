package main

import (
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestParseVideoPacketHeaderWireLayout(t *testing.T) {
	data := make([]byte, videoHeaderSize)
	binary.LittleEndian.PutUint32(data[0:4], 0)
	binary.LittleEndian.PutUint32(data[4:8], 1080)
	binary.LittleEndian.PutUint32(data[8:12], 2400)
	data[12] = 1
	data[13] = 3
	binary.LittleEndian.PutUint16(data[14:16], 2)
	binary.LittleEndian.PutUint32(data[16:20], 60000000)
	binary.LittleEndian.PutUint32(data[20:24], 42)
	binary.LittleEndian.PutUint64(data[24:32], 1000000)
	binary.LittleEndian.PutUint64(data[32:40], 16667)
	binary.LittleEndian.PutUint32(data[40:44], 3)

	header, err := parseVideoPacketHeader(data)
	if err != nil {
		t.Fatal(err)
	}
	if header.displayID != 0 || header.displayWidth != 1080 || header.displayHeight != 2400 {
		t.Fatalf("unexpected display metadata: %+v", header)
	}
	if header.orientation != 1 || header.orientationFix != 3 || header.flags != 2 {
		t.Fatalf("unexpected orientation or flags: %+v", header)
	}
	if header.frameNumber != 42 || header.presentationUS != 16667 || header.packetSize != 3 {
		t.Fatalf("unexpected frame metadata: %+v", header)
	}
}

func TestAVCParserAnnexBAndLengthPrefixed(t *testing.T) {
	parser := &avcStreamParser{lengthSize: 4}
	configuration := []byte{
		0, 0, 0, 1, 0x67, 0x42, 0, 0x1e,
		0, 0, 0, 1, 0x68, 0xce,
		0, 0, 0, 1, 0x65, 0xaa,
	}
	nalus, changed, err := parser.parse(configuration)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(nalus) != 3 || len(parser.sps) == 0 || len(parser.pps) == 0 {
		t.Fatalf("failed to read Annex-B configuration: changed=%v nalus=%d", changed, len(nalus))
	}

	packet := []byte{0, 0, 0, 2, 0x65, 0xbb, 0, 0, 0, 2, 0x41, 0xcc}
	nalus, changed, err = parser.parse(packet)
	if err != nil {
		t.Fatal(err)
	}
	if changed || len(nalus) != 2 || !hasVideoNALU(nalus) {
		t.Fatalf("failed to parse length-prefixed AVC access unit: changed=%v nalus=%d", changed, len(nalus))
	}
	if !reflect.DeepEqual(nalus, [][]byte{{0x65, 0xbb}, {0x41, 0xcc}}) {
		t.Fatalf("unexpected NAL units: %x", nalus)
	}
}

func TestParseAVCDecoderConfigurationRecord(t *testing.T) {
	record := []byte{
		1, 0x42, 0, 0x1e, 0xff, 0xe1,
		0, 4, 0x67, 0x42, 0, 0x1e,
		1, 0, 2, 0x68, 0xce,
	}
	nalus, lengthSize, err := parseAVCDecoderConfigurationRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	if lengthSize != 4 || len(nalus) != 2 || nalus[0][0]&0x1f != 7 || nalus[1][0]&0x1f != 8 {
		t.Fatalf("unexpected AVC configuration: lengthSize=%d nalus=%x", lengthSize, nalus)
	}
}

func TestSendLatestFrameReplacesStaleFrame(t *testing.T) {
	queue := make(chan decodedFrame, 1)
	for _, timestamp := range []int64{1000, 2000, 3000} {
		sendLatestFrame(queue, decodedFrame{metadata: streamFrame{presentationUS: timestamp}})
	}
	if got := (<-queue).metadata.presentationUS; got != 3000 {
		t.Fatalf("queued timestamp = %d, want latest timestamp 3000", got)
	}
}

func TestEncodeInputCommand(t *testing.T) {
	motion, err := encodeInputCommand(inputCommand{
		Type: "motion",
		Pointers: []motionPointer{{
			X:        150,
			Y:        200,
			ID:       0,
			AxisData: []motionAxis{{Axis: 9, Value: -120}},
		}},
		Action:       8,
		ButtonState:  1,
		ActionButton: 1,
		DisplayID:    0,
		IsMouse:      true,
	})
	if err != nil {
		t.Fatal(err)
	}
	wantMotion := []byte{1, 1, 0x96, 1, 0xc8, 1, 0, 1, 9, 0, 0, 0xf0, 0xc2, 8, 1, 1, 0, 1}
	if !reflect.DeepEqual(motion, wantMotion) {
		t.Fatalf("motion bytes = % x, want % x", motion, wantMotion)
	}

	key, err := encodeInputCommand(inputCommand{Type: "key", Action: 0, KeyCode: 29, MetaState: 1})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(key, []byte{2, 0, 29, 1}) {
		t.Fatalf("key bytes = % x, want 02 00 1d 01", key)
	}
}

func TestOpusPacketDurationAndEnvelope(t *testing.T) {
	if got := opusPacketDurationUS([]byte{0x98}); got != 20000 {
		t.Fatalf("20 ms Opus packet duration = %d, want 20000", got)
	}

	packet := audioPacket{config: true, timestamp: 1234, data: []byte{1, 2, 3}}
	encoded := encodeAudioWebSocketPacket(packet)
	if encoded[0] != 1 || binary.BigEndian.Uint64(encoded[1:9]) != 1234 || !reflect.DeepEqual(encoded[9:], packet.data) {
		t.Fatalf("unexpected audio websocket envelope: % x", encoded)
	}
}

func TestAudioWebSocketSendsConfigBeforeQueuedPackets(t *testing.T) {
	audioMu.Lock()
	previousConfig := audioConfig
	audioConfig = []byte("OpusHead setup")
	audioMu.Unlock()
	t.Cleanup(func() {
		audioMu.Lock()
		audioConfig = previousConfig
		audioMu.Unlock()
	})
	server := httptest.NewServer(http.HandlerFunc(audioWebSocketHandler))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	for index := 0; index < 20; index++ {
		broadcastAudio(audioPacket{data: []byte{0xfc, 0xff, 0xfe}})
	}
	_, message, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if message[0] != 1 || string(message[9:]) != "OpusHead setup" {
		t.Fatalf("first audio packet must be codec setup, got % x", message)
	}
}

func TestOpusHeadFromAndroidCodecConfig(t *testing.T) {
	config := []byte{
		'A', 'O', 'P', 'U', 'S', 'H', 'D', 'R', 19, 0, 0, 0, 0, 0, 0, 0,
		'O', 'p', 'u', 's', 'H', 'e', 'a', 'd', 1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0,
		'A', 'O', 'P', 'U', 'S', 'D', 'L', 'Y', 8, 0, 0, 0, 0, 0, 0, 0, 0xa0, 0x2e, 0x63, 0, 0, 0, 0, 0,
	}
	head, err := opusHeadFromAndroidConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	if string(head[:8]) != "OpusHead" || len(head) != 19 || head[9] != 2 {
		t.Fatalf("unexpected OpusHead: % x", head)
	}
}
