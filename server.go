package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	SOCKET_ADDR      = ":5050"
	HTTP_ADDR        = ":8080"
	BOUNDARY         = "frame"
	videoHeaderSize  = 44
	codecHeaderSize  = 20
	maxVideoPacket   = 64 * 1024 * 1024
	primaryDisplayID = 0
)

type streamFrame struct {
	displayID      int32
	displayWidth   int32
	displayHeight  int32
	orientation    uint8
	presentationUS int64
	jpeg           []byte
}

type decodedFrame struct {
	metadata streamFrame
	pixels   *image.RGBA
}

type jpegWorker struct {
	frames chan decodedFrame
	done   chan struct{}
}

type displayState struct {
	ID          int32 `json:"id"`
	Width       int32 `json:"width"`
	Height      int32 `json:"height"`
	Orientation uint8 `json:"orientation"`
}

type serverStatus struct {
	VideoConnected   bool   `json:"videoConnected"`
	AudioConnected   bool   `json:"audioConnected"`
	ControlConnected bool   `json:"controlConnected"`
	VideoPackets     uint64 `json:"videoPackets"`
	LastVideoPTS     int64  `json:"lastVideoPTSUs"`
}

type motionPointer struct {
	X        int32        `json:"x"`
	Y        int32        `json:"y"`
	ID       int32        `json:"id"`
	AxisData []motionAxis `json:"axes"`
}

type motionAxis struct {
	Axis  int32   `json:"axis"`
	Value float32 `json:"value"`
}

type inputCommand struct {
	Type         string          `json:"type"`
	Pointers     []motionPointer `json:"pointers"`
	Action       int32           `json:"action"`
	ButtonState  int32           `json:"buttonState"`
	ActionButton int32           `json:"actionButton"`
	DisplayID    int32           `json:"displayId"`
	IsMouse      bool            `json:"isMouse"`
	KeyCode      int32           `json:"keyCode"`
	MetaState    uint32          `json:"metaState"`
}

type audioPacket struct {
	config    bool
	timestamp int64
	data      []byte
}

type audioClient struct {
	conn    *websocket.Conn
	packets chan audioPacket
}

type streamClient struct {
	displayID int32
	frames    chan streamFrame
}

var (
	clients          = make(map[*streamClient]struct{})
	clientsMu        sync.Mutex
	displayStates    = make(map[int32]displayState)
	displayStateMu   sync.RWMutex
	agentControl     net.Conn
	agentControlMu   sync.Mutex
	audioClients     = make(map[*audioClient]struct{})
	audioConfig      []byte
	audioTimeUS      int64
	audioMu          sync.Mutex
	channelStatusMu  sync.RWMutex
	videoChannels    int
	audioChannels    int
	videoPacketCount atomic.Uint64
	lastVideoPTS     atomic.Int64
)

var websocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(request *http.Request) bool {
		origin := request.Header.Get("Origin")
		if origin == "" {
			return true
		}
		if strings.HasPrefix(origin, "vscode-webview://") {
			return true
		}
		return strings.EqualFold(origin, "http://"+request.Host) || strings.EqualFold(origin, "https://"+request.Host)
	},
}

func main() {
	log.Printf("HTTP stream: http://localhost%s/stream", HTTP_ADDR)
	log.Printf("Agent socket: TCP %s (adb reverse localabstract:screen-sharing-agent tcp:%s)", SOCKET_ADDR, strings.TrimPrefix(SOCKET_ADDR, ":"))
	go startTCP()

	fs := http.FileServer(http.Dir("."))
	http.Handle("/", fs)
	http.HandleFunc("/stream", mjpegHandler)
	http.HandleFunc("/control", controlWebSocketHandler)
	http.HandleFunc("/audio", audioWebSocketHandler)
	http.HandleFunc("/api/display-state", displayStateHandler)
	http.HandleFunc("/api/status", serverStatusHandler)
	log.Fatal(http.ListenAndServe(HTTP_ADDR, nil))
}

func startTCP() {
	listener, err := net.Listen("tcp", SOCKET_ADDR)
	if err != nil {
		log.Fatal(err)
	}
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Agent socket accept failed: %v", err)
			continue
		}
		go handleConn(conn)
	}
}

func handleConn(conn net.Conn) {
	defer conn.Close()
	reader := bufio.NewReader(conn)
	marker, err := reader.ReadByte()
	if err != nil {
		return
	}
	if marker == 'V' || marker == 'A' || marker == 'C' {
		trackAgentChannel(marker, 1)
		defer trackAgentChannel(marker, -1)
	}

	switch marker {
	case 'V':
		log.Printf("Agent video channel connected from %s", conn.RemoteAddr())
		handleVideo(reader)
	case 'A':
		log.Printf("Agent audio channel connected from %s", conn.RemoteAddr())
		handleAudio(reader)
	case 'C':
		log.Printf("Agent control channel connected from %s", conn.RemoteAddr())
		handleControl(conn, reader)
	default:
		log.Printf("Unknown agent channel marker %q from %s", marker, conn.RemoteAddr())
	}
}

func trackAgentChannel(marker byte, delta int) {
	channelStatusMu.Lock()
	switch marker {
	case 'V':
		videoChannels += delta
	case 'A':
		audioChannels += delta
	}
	channelStatusMu.Unlock()
}

func serverStatusHandler(w http.ResponseWriter, r *http.Request) {
	channelStatusMu.RLock()
	status := serverStatus{
		VideoConnected: videoChannels > 0,
		AudioConnected: audioChannels > 0,
		VideoPackets:   videoPacketCount.Load(),
		LastVideoPTS:   lastVideoPTS.Load(),
	}
	channelStatusMu.RUnlock()
	agentControlMu.Lock()
	status.ControlConnected = agentControl != nil
	agentControlMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(status)
}

type videoPacketHeader struct {
	displayID      int32
	displayWidth   int32
	displayHeight  int32
	orientation    uint8
	orientationFix uint8
	flags          int16
	bitRate        int32
	frameNumber    uint32
	originationUS  int64
	presentationUS int64
	packetSize     int32
}

func parseVideoPacketHeader(data []byte) (videoPacketHeader, error) {
	if len(data) != videoHeaderSize {
		return videoPacketHeader{}, fmt.Errorf("video header has %d bytes, want %d", len(data), videoHeaderSize)
	}
	return videoPacketHeader{
		displayID:      int32(binary.LittleEndian.Uint32(data[0:4])),
		displayWidth:   int32(binary.LittleEndian.Uint32(data[4:8])),
		displayHeight:  int32(binary.LittleEndian.Uint32(data[8:12])),
		orientation:    data[12],
		orientationFix: data[13],
		flags:          int16(binary.LittleEndian.Uint16(data[14:16])),
		bitRate:        int32(binary.LittleEndian.Uint32(data[16:20])),
		frameNumber:    binary.LittleEndian.Uint32(data[20:24]),
		originationUS:  int64(binary.LittleEndian.Uint64(data[24:32])),
		presentationUS: int64(binary.LittleEndian.Uint64(data[32:40])),
		packetSize:     int32(binary.LittleEndian.Uint32(data[40:44])),
	}, nil
}

type avcStreamParser struct {
	lengthSize int
	sps        []byte
	pps        []byte
}

func (p *avcStreamParser) parse(data []byte) ([][]byte, bool, error) {
	if len(data) == 0 {
		return nil, false, nil
	}
	if isAVCDecoderConfigurationRecord(data) {
		nalus, lengthSize, err := parseAVCDecoderConfigurationRecord(data)
		if err != nil {
			return nil, false, err
		}
		p.lengthSize = lengthSize
		changed := p.updateParameterSets(nalus)
		return nalus, changed, nil
	}

	var nalus [][]byte
	if hasAnnexBStartCode(data) {
		nalus = splitAnnexBNALUs(data)
	} else {
		lengthSizes := []int{p.lengthSize, 4, 2, 1, 3}
		for _, lengthSize := range lengthSizes {
			if lengthSize <= 0 || lengthSize > 4 {
				continue
			}
			parsed, ok := splitLengthPrefixedNALUs(data, lengthSize)
			if ok {
				nalus = parsed
				p.lengthSize = lengthSize
				break
			}
		}
		if len(nalus) == 0 && isNALUnit(data) {
			nalus = [][]byte{data}
		}
		if len(nalus) == 0 {
			return nil, false, errors.New("video packet is neither Annex-B nor length-prefixed AVC")
		}
	}
	changed := p.updateParameterSets(nalus)
	return nalus, changed, nil
}

func (p *avcStreamParser) updateParameterSets(nalus [][]byte) bool {
	var nextSPS, nextPPS []byte
	for _, nalu := range nalus {
		if len(nalu) == 0 {
			continue
		}
		switch nalu[0] & 0x1f {
		case 7:
			nextSPS = append([]byte(nil), nalu...)
		case 8:
			nextPPS = append([]byte(nil), nalu...)
		}
	}
	changed := false
	if len(nextSPS) != 0 && !bytes.Equal(p.sps, nextSPS) {
		p.sps = nextSPS
		changed = true
	}
	if len(nextPPS) != 0 && !bytes.Equal(p.pps, nextPPS) {
		p.pps = nextPPS
		changed = true
	}
	return changed
}

func isAVCDecoderConfigurationRecord(data []byte) bool {
	return len(data) >= 7 && data[0] == 1 && data[4]&0xfc == 0xfc && data[5]&0xe0 == 0xe0
}

func parseAVCDecoderConfigurationRecord(data []byte) ([][]byte, int, error) {
	if !isAVCDecoderConfigurationRecord(data) {
		return nil, 0, errors.New("invalid AVC decoder configuration record")
	}
	lengthSize := int(data[4]&0x03) + 1
	position := 6
	sets := make([][]byte, 0, int(data[5]&0x1f)+1)
	readSets := func(count int) error {
		for i := 0; i < count; i++ {
			if position+2 > len(data) {
				return errors.New("truncated AVC parameter-set length")
			}
			size := int(binary.BigEndian.Uint16(data[position : position+2]))
			position += 2
			if size == 0 || position+size > len(data) {
				return errors.New("truncated AVC parameter set")
			}
			sets = append(sets, append([]byte(nil), data[position:position+size]...))
			position += size
		}
		return nil
	}
	if err := readSets(int(data[5] & 0x1f)); err != nil {
		return nil, 0, err
	}
	if position >= len(data) {
		return nil, 0, errors.New("AVC configuration has no PPS count")
	}
	ppsCount := int(data[position])
	position++
	if err := readSets(ppsCount); err != nil {
		return nil, 0, err
	}
	return sets, lengthSize, nil
}

func hasAnnexBStartCode(data []byte) bool {
	_, _, ok := findAnnexBStartCode(data, 0)
	return ok
}

func findAnnexBStartCode(data []byte, from int) (int, int, bool) {
	for i := from; i+2 < len(data); i++ {
		if data[i] != 0 || data[i+1] != 0 {
			continue
		}
		if data[i+2] == 1 {
			return i, 3, true
		}
		if i+3 < len(data) && data[i+2] == 0 && data[i+3] == 1 {
			return i, 4, true
		}
	}
	return 0, 0, false
}

func splitAnnexBNALUs(data []byte) [][]byte {
	position, prefixSize, ok := findAnnexBStartCode(data, 0)
	if !ok {
		return nil
	}
	result := make([][]byte, 0, 4)
	for ok {
		start := position + prefixSize
		nextPosition, nextPrefixSize, found := findAnnexBStartCode(data, start)
		end := len(data)
		if found {
			end = nextPosition
		}
		for end > start && data[end-1] == 0 {
			end--
		}
		if end > start {
			result = append(result, data[start:end])
		}
		position, prefixSize, ok = nextPosition, nextPrefixSize, found
	}
	return result
}

func splitLengthPrefixedNALUs(data []byte, lengthSize int) ([][]byte, bool) {
	position := 0
	result := make([][]byte, 0, 4)
	for position < len(data) {
		if position+lengthSize > len(data) {
			return nil, false
		}
		var size uint32
		for _, value := range data[position : position+lengthSize] {
			size = size<<8 | uint32(value)
		}
		position += lengthSize
		if size == 0 || uint64(position)+uint64(size) > uint64(len(data)) {
			return nil, false
		}
		end := position + int(size)
		if !isNALUnit(data[position:end]) {
			return nil, false
		}
		result = append(result, data[position:end])
		position = end
	}
	return result, len(result) != 0
}

func isNALUnit(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	typeID := data[0] & 0x1f
	return data[0]&0x80 == 0 && typeID > 0 && typeID < 24
}

func hasVideoNALU(nalus [][]byte) bool {
	for _, nalu := range nalus {
		if len(nalu) != 0 {
			typeID := nalu[0] & 0x1f
			if typeID >= 1 && typeID <= 5 {
				return true
			}
		}
	}
	return false
}

func handleVideo(reader *bufio.Reader) {
	codecHeader := make([]byte, codecHeaderSize)
	if _, err := io.ReadFull(reader, codecHeader); err != nil {
		log.Printf("Video codec header read failed: %v", err)
		return
	}
	codec := strings.TrimRight(string(codecHeader), "\x00 ")
	if codec != "avc" {
		log.Printf("Unsupported agent video codec %q; this server decodes AVC", codec)
		return
	}
	log.Printf("Agent video codec: %s", codec)

	parser := &avcStreamParser{lengthSize: 4}
	decoders := make(map[int32]*h264Decoder)
	jpegWorkers := make(map[int32]*jpegWorker)
	defer func() {
		for _, decoder := range decoders {
			decoder.close()
		}
		for _, worker := range jpegWorkers {
			close(worker.frames)
		}
		for _, worker := range jpegWorkers {
			<-worker.done
		}
	}()

	for {
		encodedHeader := make([]byte, videoHeaderSize)
		if _, err := io.ReadFull(reader, encodedHeader); err != nil {
			if err != io.EOF {
				log.Printf("Video packet header read failed: %v", err)
			}
			return
		}
		header, err := parseVideoPacketHeader(encodedHeader)
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

		payload := make([]byte, int(header.packetSize))
		if _, err := io.ReadFull(reader, payload); err != nil {
			log.Printf("Incomplete video packet (%d bytes): %v", header.packetSize, err)
			return
		}
		nalus, configChanged, err := parser.parse(payload)
		if err != nil {
			log.Printf("Invalid AVC payload: %v", err)
			return
		}
		if configChanged {
			for displayID, decoder := range decoders {
				decoder.close()
				delete(decoders, displayID)
			}
		}
		if header.presentationUS == 0 || !hasVideoNALU(nalus) {
			continue
		}
		if len(parser.sps) == 0 || len(parser.pps) == 0 {
			log.Printf("Video frame arrived before AVC SPS/PPS configuration")
			continue
		}

		decoder := decoders[header.displayID]
		if decoder == nil {
			decoder, err = newH264Decoder(parser.sps, parser.pps, int(header.displayWidth), int(header.displayHeight), header.orientation)
			if err != nil {
				log.Printf("Could not initialize AVC decoder for display %d: %v", header.displayID, err)
				return
			}
			decoders[header.displayID] = decoder
		}
		frame, err := decoder.decode(nalus, time.Duration(header.presentationUS)*time.Microsecond)
		if err != nil {
			log.Printf("AVC decode failed for display %d: %v", header.displayID, err)
			decoder.close()
			delete(decoders, header.displayID)
			continue
		}
		if frame == nil {
			continue
		}

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
			},
			pixels: frame,
		})
	}
}

func startJPEGWorker() *jpegWorker {
	worker := &jpegWorker{frames: make(chan decodedFrame, 1), done: make(chan struct{})}
	go func() {
		defer close(worker.done)
		for frame := range worker.frames {
			var jpegBuffer bytes.Buffer
			if err := jpeg.Encode(&jpegBuffer, frame.pixels, &jpeg.Options{Quality: 95}); err != nil {
				log.Printf("JPEG encode failed: %v", err)
				continue
			}
			frame.metadata.jpeg = jpegBuffer.Bytes()
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
	case <-queue:
	default:
	}
	select {
	case queue <- frame:
	default:
	}
}

func appendLEB128(buffer []byte, value uint32) []byte {
	for value >= 0x80 {
		buffer = append(buffer, byte(value)|0x80)
		value >>= 7
	}
	return append(buffer, byte(value))
}

func appendControlInt(buffer []byte, value int32) []byte {
	return appendLEB128(buffer, uint32(value))
}

func encodeInputCommand(command inputCommand) ([]byte, error) {
	var message []byte
	switch command.Type {
	case "motion":
		if len(command.Pointers) > 2 {
			return nil, errors.New("agent accepts at most two pointers")
		}
		message = appendControlInt(message, 1)
		message = appendLEB128(message, uint32(len(command.Pointers)))
		for _, pointer := range command.Pointers {
			message = appendControlInt(message, pointer.X)
			message = appendControlInt(message, pointer.Y)
			message = appendControlInt(message, pointer.ID)
			message = appendLEB128(message, uint32(len(pointer.AxisData)))
			for _, axis := range pointer.AxisData {
				message = appendControlInt(message, axis.Axis)
				var value [4]byte
				binary.LittleEndian.PutUint32(value[:], math.Float32bits(axis.Value))
				message = append(message, value[:]...)
			}
		}
		message = appendControlInt(message, command.Action)
		message = appendControlInt(message, command.ButtonState)
		message = appendControlInt(message, command.ActionButton)
		message = appendControlInt(message, command.DisplayID)
		if command.IsMouse {
			message = append(message, 1)
		} else {
			message = append(message, 0)
		}
	case "key":
		message = appendControlInt(message, 2)
		message = appendControlInt(message, command.Action)
		message = appendControlInt(message, command.KeyCode)
		message = appendLEB128(message, command.MetaState)
	default:
		return nil, fmt.Errorf("unsupported input type %q", command.Type)
	}
	return message, nil
}

func handleControl(conn net.Conn, reader io.Reader) {
	agentControlMu.Lock()
	agentControl = conn
	agentControlMu.Unlock()
	defer func() {
		agentControlMu.Lock()
		if agentControl == conn {
			agentControl = nil
		}
		agentControlMu.Unlock()
	}()
	_, _ = io.Copy(io.Discard, reader)
}

func sendAgentControl(message []byte) error {
	agentControlMu.Lock()
	defer agentControlMu.Unlock()
	if agentControl == nil {
		return errors.New("agent control channel is not connected")
	}
	for len(message) != 0 {
		written, err := agentControl.Write(message)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		message = message[written:]
	}
	return nil
}

func controlWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(64 * 1024)
	for {
		var command inputCommand
		if err := conn.ReadJSON(&command); err != nil {
			return
		}
		message, err := encodeInputCommand(command)
		if err == nil {
			err = sendAgentControl(message)
		}
		if err != nil {
			_ = conn.WriteJSON(map[string]string{"error": err.Error()})
		}
	}
}

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
	if len(audioConfig) != 0 {
		client.packets <- audioPacket{config: true, data: append([]byte(nil), audioConfig...)}
	}
	audioMu.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
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

func displayStateHandler(w http.ResponseWriter, r *http.Request) {
	displayID := int32(primaryDisplayID)
	if value := r.URL.Query().Get("display"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 32)
		if err != nil || parsed < 0 {
			http.Error(w, "invalid display id", http.StatusBadRequest)
			return
		}
		displayID = int32(parsed)
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
	for client := range clients {
		if client.displayID != frame.displayID {
			continue
		}
		select {
		case client.frames <- frame:
		default:
			select {
			case <-client.frames:
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
	displayID := int32(primaryDisplayID)
	if value := r.URL.Query().Get("display"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 32)
		if err != nil || parsed < 0 {
			http.Error(w, "invalid display id", http.StatusBadRequest)
			return
		}
		displayID = int32(parsed)
	}
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+BOUNDARY)
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is not supported", http.StatusInternalServerError)
		return
	}
	client := &streamClient{displayID: displayID, frames: make(chan streamFrame, 2)}
	clientsMu.Lock()
	clients[client] = struct{}{}
	clientsMu.Unlock()
	defer func() {
		clientsMu.Lock()
		delete(clients, client)
		clientsMu.Unlock()
	}()

	log.Printf("MJPEG client connected for display %d", displayID)
	for {
		select {
		case <-r.Context().Done():
			return
		case frame := <-client.frames:
			if _, err := fmt.Fprintf(w,
				"--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\nX-Display-ID: %d\r\nX-Display-Width: %d\r\nX-Display-Height: %d\r\nX-Display-Orientation: %d\r\nX-Presentation-Timestamp-Us: %d\r\n\r\n",
				BOUNDARY, len(frame.jpeg), frame.displayID, frame.displayWidth, frame.displayHeight, frame.orientation, frame.presentationUS); err != nil {
				return
			}
			if _, err := w.Write(frame.jpeg); err != nil {
				return
			}
			if _, err := io.WriteString(w, "\r\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func indexHandler(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile("index.html")
	if err != nil {
		http.Error(w, "missing index.html", http.StatusInternalServerError)
		return
	}
	_, _ = w.Write(data)
}
