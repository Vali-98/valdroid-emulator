package server

import (
	"bufio"
	"image"
	"io"
	"log"
	"strings"
	"sync/atomic"
	"time"

	"emu_stream_test/internal/codec"
)

type decodedFrame struct {
	metadata  streamFrame
	pixels    *image.RGBA
	decodedAt time.Time
}

type jpegWorker struct {
	frames chan decodedFrame
	done   chan struct{}
}

var (
	videoPacketCount atomic.Uint64
	lastVideoPTS     atomic.Int64
)

func handleVideo(reader *bufio.Reader) {
	codecHeader := make([]byte, codecHeaderSize)
	if _, err := io.ReadFull(reader, codecHeader); err != nil {
		log.Printf("Video codec header read failed: %v", err)
		return
	}
	codecName := strings.TrimRight(string(codecHeader), "\x00 ")
	if codecName != "avc" {
		log.Printf("Unsupported agent video codec %q; this server decodes AVC", codecName)
		return
	}
	log.Printf("Agent video codec: %s", codecName)

	parsers := make(map[int32]*avcStreamParser)
	decoders := make(map[int32]*codec.Decoder)
	jpegWorkers := make(map[int32]*jpegWorker)
	defer func() {
		for _, decoder := range decoders {
			decoder.Close()
		}
		for _, worker := range jpegWorkers {
			close(worker.frames)
		}
		for _, worker := range jpegWorkers {
			<-worker.done
		}
	}()

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
		nalus, configChanged, err := parser.parse(payload)
		if err != nil {
			log.Printf("Invalid AVC payload: %v", err)
			return
		}
		if configChanged {
			if decoder := decoders[header.displayID]; decoder != nil {
				decoder.Close()
				delete(decoders, header.displayID)
			}
		}
		if header.presentationUS == 0 || !hasVideoNALU(nalus) {
			continue
		}
		if len(parser.sps) == 0 || len(parser.pps) == 0 {
			log.Printf("Video frame arrived before AVC SPS/PPS configuration")
			continue
		}
		received := time.Now()
		metrics := metricsFor(header.displayID)
		metrics.receive(received, header.presentationUS)

		decoder := decoders[header.displayID]
		if decoder == nil {
			decoder, err = codec.NewDecoder(parser.sps, parser.pps, int(header.displayWidth), int(header.displayHeight), header.orientation)
			if err != nil {
				log.Printf("Could not initialize AVC decoder for display %d: %v", header.displayID, err)
				return
			}
			decoders[header.displayID] = decoder
		}
		decodeStarted := time.Now()
		frame, err := decoder.Decode(nalus, time.Duration(header.presentationUS)*time.Microsecond)
		metrics.mu.Lock()
		metrics.decode.add(time.Since(decodeStarted))
		if err != nil {
			metrics.decodeErrors++
		}
		metrics.mu.Unlock()
		if err != nil {
			log.Printf("AVC decode failed for display %d: %v", header.displayID, err)
			decoder.Close()
			delete(decoders, header.displayID)
			continue
		}
		if frame == nil {
			continue
		}
		metrics.mu.Lock()
		metrics.decoded++
		metrics.mu.Unlock()

		worker := jpegWorkers[header.displayID]
		if worker == nil {
			worker = startJPEGWorker()
			jpegWorkers[header.displayID] = worker
		}
		sendLatestFrame(worker.frames, decodedFrame{
			metadata: streamFrame{
				displayID:      header.displayID,
				displayWidth:   header.displayWidth,
				displayHeight:  header.displayHeight,
				orientation:    header.orientation,
				presentationUS: header.presentationUS,
				receivedAt:     received,
				frameNumber:    header.frameNumber,
			},
			pixels:    frame,
			decodedAt: time.Now(),
		})
	}
}

func startJPEGWorker() *jpegWorker {
	worker := &jpegWorker{frames: make(chan decodedFrame, 1), done: make(chan struct{})}
	go func() {
		defer close(worker.done)
		encoder, err := codec.NewJPEGEncoder()
		if err != nil {
			log.Printf("JPEG encoder initialization failed: %v", err)
			for frame := range worker.frames {
				codec.ReleaseFrame(frame.pixels)
			}
			return
		}
		defer encoder.Close()
		for frame := range worker.frames {
			metrics := metricsFor(frame.metadata.displayID)
			started := time.Now()
			if !frame.decodedAt.IsZero() {
				metrics.mu.Lock()
				metrics.queue.add(started.Sub(frame.decodedAt))
				metrics.mu.Unlock()
			}
			encoded, err := encoder.Encode(frame.pixels, jpegQuality)
			finished := time.Now()
			metrics.mu.Lock()
			metrics.encode.add(finished.Sub(started))
			if err != nil {
				metrics.encodeErrors++
			} else {
				metrics.encoded++
				if !metrics.lastEncode.IsZero() {
					metrics.encodeIntervals.add(finished.Sub(metrics.lastEncode))
				}
				metrics.lastEncode = finished
			}
			metrics.mu.Unlock()
			codec.ReleaseFrame(frame.pixels)
			if err != nil {
				log.Printf("JPEG encode failed: %v", err)
				continue
			}
			frame.metadata.jpeg = encoded
			broadcast(frame.metadata)
		}
	}()
	return worker
}

func sendLatestFrame(queue chan decodedFrame, frame decodedFrame) {
	select {
	case queue <- frame:
		return
	default:
	}
	select {
	case stale := <-queue:
		metrics := metricsFor(stale.metadata.displayID)
		metrics.mu.Lock()
		metrics.encodeDrops++
		metrics.mu.Unlock()
		codec.ReleaseFrame(stale.pixels)
	default:
	}
	select {
	case queue <- frame:
	default:
		metrics := metricsFor(frame.metadata.displayID)
		metrics.mu.Lock()
		metrics.encodeDrops++
		metrics.mu.Unlock()
		codec.ReleaseFrame(frame.pixels)
	}
}
