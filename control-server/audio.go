package main

import (
	"encoding/binary"
	"errors"
	"io"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type audioPacket struct {
	config    bool
	timestamp int64
	data      []byte
}

type audioClient struct {
	conn    *websocket.Conn
	packets chan audioPacket
}

var (
	audioClients     = make(map[*audioClient]struct{})
	audioConfig      []byte
	audioMu          sync.Mutex
	audioPacketCount atomic.Uint64
)

func handleAudio(reader io.Reader) {
	var timestamp int64
	for {
		var header [4]byte
		if _, err := io.ReadFull(reader, header[:]); err != nil {
			if err != io.EOF {
				log.Printf("Audio packet header read failed: %v", err)
			}
			return
		}
		rawHeader := binary.LittleEndian.Uint32(header[:])
		packetSize := rawHeader & 0x7fffffff
		if packetSize > maxVideoPacket {
			log.Printf("Invalid audio packet size %d", packetSize)
			return
		}
		payload := make([]byte, int(packetSize))
		if _, err := io.ReadFull(reader, payload); err != nil {
			log.Printf("Incomplete audio packet (%d bytes): %v", packetSize, err)
			return
		}
		isConfig := rawHeader&0x80000000 != 0
		if isConfig {
			opusHead, err := opusHeadFromAndroidConfig(payload)
			if err != nil {
				log.Printf("Invalid Opus codec configuration: %v", err)
				continue
			}
			payload = opusHead
			timestamp = 0
			audioMu.Lock()
			audioConfig = append(audioConfig[:0], payload...)
			audioMu.Unlock()
		}
		broadcastAudio(audioPacket{config: isConfig, timestamp: timestamp, data: payload})
		if !isConfig {
			audioPacketCount.Add(1)
			timestamp += opusPacketDurationUS(payload)
		}
	}
}

func opusHeadFromAndroidConfig(data []byte) ([]byte, error) {
	if len(data) >= 19 && string(data[:8]) == "OpusHead" {
		return append([]byte(nil), data...), nil
	}
	for position := 0; position+16 <= len(data); position++ {
		if string(data[position:position+8]) != "AOPUSHDR" {
			continue
		}
		headerSize := binary.LittleEndian.Uint64(data[position+8 : position+16])
		start := position + 16
		if headerSize < 19 || headerSize > uint64(len(data)-start) {
			return nil, errors.New("invalid AOPUSHDR length")
		}
		opusHead := data[start : start+int(headerSize)]
		if string(opusHead[:8]) != "OpusHead" {
			return nil, errors.New("AOPUSHDR does not contain OpusHead")
		}
		return append([]byte(nil), opusHead...), nil
	}
	return nil, errors.New("AOPUSHDR record not found")
}

func opusPacketDurationUS(packet []byte) int64 {
	if len(packet) == 0 {
		return 0
	}
	config := packet[0] >> 3
	var frameDuration int64
	switch {
	case config >= 16:
		frameDuration = []int64{2500, 5000, 10000, 20000}[config&0x03]
	case config >= 12:
		frameDuration = []int64{10000, 20000}[config&0x01]
	default:
		frameDuration = []int64{10000, 20000, 40000, 60000}[config&0x03]
	}
	frameCount := int64(1)
	switch packet[0] & 0x03 {
	case 1, 2:
		frameCount = 2
	case 3:
		if len(packet) < 2 {
			return 0
		}
		frameCount = int64(packet[1] & 0x3f)
	}
	if frameCount == 0 || frameDuration*frameCount > 120000 {
		return 0
	}
	return frameDuration * frameCount
}

func encodeAudioWebSocketPacket(packet audioPacket) []byte {
	message := make([]byte, 9+len(packet.data))
	if packet.config {
		message[0] = 1
	}
	binary.BigEndian.PutUint64(message[1:9], uint64(packet.timestamp))
	copy(message[9:], packet.data)
	return message
}

func broadcastAudio(packet audioPacket) {
	audioMu.Lock()
	defer audioMu.Unlock()
	for client := range audioClients {
		select {
		case client.packets <- packet:
		default:
			select {
			case <-client.packets:
			default:
			}
			select {
			case client.packets <- packet:
			default:
			}
		}
	}
}

func audioWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &audioClient{conn: conn, packets: make(chan audioPacket, 8)}
	audioMu.Lock()
	audioClients[client] = struct{}{}
	var initialConfig []byte
	if len(audioConfig) != 0 {
		initialConfig = append([]byte(nil), audioConfig...)
	}
	audioMu.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		if len(initialConfig) != 0 {
			_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
			if err := conn.WriteMessage(websocket.BinaryMessage, encodeAudioWebSocketPacket(audioPacket{config: true, data: initialConfig})); err != nil {
				_ = conn.Close()
				return
			}
		}
		for packet := range client.packets {
			_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
			if err := conn.WriteMessage(websocket.BinaryMessage, encodeAudioWebSocketPacket(packet)); err != nil {
				_ = conn.Close()
				return
			}
		}
	}()
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	audioMu.Lock()
	delete(audioClients, client)
	close(client.packets)
	audioMu.Unlock()
	conn.Close()
	<-done
}
