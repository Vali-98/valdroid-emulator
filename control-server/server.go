package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

const (
	SOCKET_ADDR           = ":5050"
	HTTP_ADDR             = ":8080"
	BOUNDARY              = "frame"
	videoHeaderSize       = 44
	codecHeaderSize       = 20
	maxVideoPacket        = 64 * 1024 * 1024
	primaryDisplayID      = 0
	adbStartupTimeout     = 90 * time.Second
	agentChannelTimeout   = 60 * time.Second
	agentLogTailMaxLength = 6000
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
	AudioConfigured  bool   `json:"audioConfigured"`
	AudioPackets     uint64 `json:"audioPackets"`
	ControlConnected bool   `json:"controlConnected"`
	VideoPackets     uint64 `json:"videoPackets"`
	LastVideoPTS     int64  `json:"lastVideoPTSUs"`
	AgentStarting    bool   `json:"agentStarting"`
	AgentStarted     bool   `json:"agentStarted"`
	AgentError       string `json:"agentError,omitempty"`
}

type agentConfig struct {
	ADBPath       string
	Serial        string
	DistDir       string
	SocketName    string
	SocketAddress string
	BitRate       int
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
	audioPacketCount atomic.Uint64
	lastVideoPTS     atomic.Int64
	agentStateMu     sync.RWMutex
	agentStarting    bool
	agentStarted     bool
	agentStartError  string
)

var deviceSerialPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]+$`)

//go:embed index.html
var indexFiles embed.FS

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
	httpAddress := flag.String("http", HTTP_ADDR, "HTTP listen address")
	socketAddress := flag.String("socket", SOCKET_ADDR, "agent TCP listen address")
	distDir := flag.String("dist-dir", "dist", "directory containing the agent archive and native libraries")
	deviceSerial := flag.String("device-serial", "", "Android device serial; installs and starts the agent after listeners are ready")
	testWebServer := flag.Bool("test-webserver", false, "serve the standalone HTML test page at /")
	adbPath := flag.String("adb", "adb", "path to adb")
	bitRate := flag.Int("bit-rate", 10000000, "agent AVC bit rate in bits per second")
	flag.Parse()

	socketListener, err := net.Listen("tcp", *socketAddress)
	if err != nil {
		log.Fatal(err)
	}
	httpListener, err := net.Listen("tcp", *httpAddress)
	if err != nil {
		_ = socketListener.Close()
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	device := deviceAPI{adbPath: *adbPath, serial: *deviceSerial}
	if *testWebServer {
		mux.Handle("/", http.FileServer(http.FS(indexFiles)))
	}
	mux.HandleFunc("/stream", mjpegHandler)
	mux.HandleFunc("/control", controlWebSocketHandler)
	mux.HandleFunc("/audio", audioWebSocketHandler)
	mux.HandleFunc("/api/display-state", displayStateHandler)
	mux.HandleFunc("/api/status", serverStatusHandler)
	mux.HandleFunc("/api/volume", device.volumeHandler)

	go startTCP(socketListener)
	shutdownContext, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		BaseContext: func(net.Listener) context.Context {
			return shutdownContext
		},
	}
	shutdownDone := make(chan struct{})
	go func() {
		<-shutdownContext.Done()
		agentControlMu.Lock()
		if agentControl != nil {
			_ = agentControl.Close()
		}
		agentControlMu.Unlock()
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			channelStatusMu.RLock()
			active := videoChannels + audioChannels
			channelStatusMu.RUnlock()
			if active == 0 {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
		_ = socketListener.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("HTTP shutdown: %v", err)
		}
		close(shutdownDone)
	}()
	log.Printf("HTTP stream: http://%s/stream", browserHost(httpListener.Addr().String()))
	log.Printf("Agent socket: TCP %s", *socketAddress)
	if *deviceSerial != "" {
		config := agentConfig{
			ADBPath:       *adbPath,
			Serial:        *deviceSerial,
			DistDir:       *distDir,
			SocketName:    "screen-sharing-agent",
			SocketAddress: *socketAddress,
			BitRate:       *bitRate,
		}
		setAgentState(true, false, "")
		go func() {
			if err := installAndStartAgent(shutdownContext, config); err != nil {
				if shutdownContext.Err() != nil {
					return
				}
				setAgentState(false, false, err.Error())
				log.Printf("Android agent startup failed: %v", err)
				return
			}
			setAgentState(false, true, "")
		}()
	}
	if err := server.Serve(httpListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-shutdownDone
}

func browserHost(address string) string {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return address
	}
	if host == "" || host == "::" || host == "0.0.0.0" || host == "[::]" {
		host = "localhost"
	}
	return net.JoinHostPort(host, port)
}

func startTCP(listener net.Listener) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			log.Printf("Agent socket accept failed: %v", err)
			continue
		}
		go handleConn(conn)
	}
}

func setAgentState(starting, started bool, err string) {
	agentStateMu.Lock()
	agentStarting = starting
	agentStarted = started
	agentStartError = err
	agentStateMu.Unlock()
}

func installAndStartAgent(parent context.Context, config agentConfig) error {
	if !deviceSerialPattern.MatchString(config.Serial) {
		return errors.New("invalid Android device serial")
	}
	if config.BitRate < 100000 || config.BitRate > 100000000 {
		return errors.New("agent bit rate must be between 100000 and 100000000")
	}
	ctx, cancel := context.WithTimeout(parent, adbStartupTimeout)
	defer cancel()

	runADB := func(args ...string) ([]byte, error) {
		command := exec.CommandContext(ctx, config.ADBPath, append([]string{"-s", config.Serial}, args...)...)
		output, err := command.CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("adb %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
		}
		return output, nil
	}

	abiOutput, err := runADB("shell", "getprop", "ro.product.cpu.abi")
	if err != nil {
		return err
	}
	abi := strings.TrimSpace(string(abiOutput))
	if !supportedAndroidABI(abi) {
		return fmt.Errorf("unsupported Android ABI %q", abi)
	}

	jarPath := filepath.Join(config.DistDir, "screen-sharing-agent.jar")
	libraryPath := filepath.Join(config.DistDir, "agent-libs", abi, "libscreen-sharing-agent.so")
	if err := requireFile(jarPath); err != nil {
		return err
	}
	if err := requireFile(libraryPath); err != nil {
		return err
	}
	if _, err := runADB("shell", "mkdir", "-p", "/data/local/tmp/.studio"); err != nil {
		return err
	}

	if !remoteFileMatches(ctx, config, jarPath, "/data/local/tmp/screen-sharing-agent.jar") {
		if _, err := runADB("push", jarPath, "/data/local/tmp/screen-sharing-agent.jar"); err != nil {
			return err
		}
	}
	if !remoteFileMatches(ctx, config, libraryPath, "/data/local/tmp/.studio/libscreen-sharing-agent.so") {
		if _, err := runADB("push", libraryPath, "/data/local/tmp/.studio/libscreen-sharing-agent.so"); err != nil {
			return err
		}
	}

	_, port, err := net.SplitHostPort(config.SocketAddress)
	if err != nil {
		return fmt.Errorf("invalid agent socket address %q: %w", config.SocketAddress, err)
	}
	if _, err := runADB("reverse", "localabstract:"+config.SocketName, "tcp:"+port); err != nil {
		return err
	}

	remoteCommand := fmt.Sprintf(
		"nohup env CLASSPATH=/data/local/tmp/screen-sharing-agent.jar LD_LIBRARY_PATH=/data/local/tmp/.studio app_process /data/local/tmp com.android.tools.screensharing.Main --socket=%s --flags=5 --max_bit_rate=%d --codec=avc >/data/local/tmp/.studio/agent.log 2>&1 </dev/null & echo $! >/data/local/tmp/.studio/agent.pid",
		config.SocketName,
		config.BitRate,
	)
	if _, err := runADB("shell", remoteCommand); err != nil {
		return err
	}

	deadline := time.Now().Add(agentChannelTimeout)
	for time.Now().Before(deadline) {
		videoReady, audioReady, controlReady := agentChannelsReady()
		if videoReady && audioReady && controlReady {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for the agent channels on %s (%s)%s", config.Serial, agentChannelSummary(videoReady, audioReady, controlReady), agentLogSuffix(config))
		case <-time.After(200 * time.Millisecond):
		}
	}
	videoReady, audioReady, controlReady := agentChannelsReady()
	return fmt.Errorf("agent process launched on %s but its channels did not connect (%s)%s", config.Serial, agentChannelSummary(videoReady, audioReady, controlReady), agentLogSuffix(config))
}

func agentChannelsReady() (bool, bool, bool) {
	channelStatusMu.RLock()
	videoReady := videoChannels > 0
	audioReady := audioChannels > 0
	channelStatusMu.RUnlock()
	agentControlMu.Lock()
	controlReady := agentControl != nil
	agentControlMu.Unlock()
	return videoReady, audioReady, controlReady
}

func agentChannelSummary(videoReady, audioReady, controlReady bool) string {
	return fmt.Sprintf("video=%t audio=%t control=%t", videoReady, audioReady, controlReady)
}

func agentLogSuffix(config agentConfig) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, config.ADBPath, "-s", config.Serial, "shell", "cat", "/data/local/tmp/.studio/agent.log")
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Sprintf("; unable to read agent log: %s", strings.TrimSpace(string(output)))
	}
	logText := strings.TrimSpace(string(output))
	if logText == "" {
		return "; agent log is empty"
	}
	if len(logText) > agentLogTailMaxLength {
		logText = logText[len(logText)-agentLogTailMaxLength:]
	}
	return "\nAgent log:\n" + logText
}

func remoteFileMatches(ctx context.Context, config agentConfig, localPath, remotePath string) bool {
	localBytes, err := os.ReadFile(localPath)
	if err != nil {
		return false
	}
	localHash := sha256.Sum256(localBytes)
	command := exec.CommandContext(ctx, config.ADBPath, "-s", config.Serial, "shell", "sha256sum", remotePath)
	output, err := command.Output()
	if err != nil {
		return false
	}
	fields := strings.Fields(string(output))
	return len(fields) != 0 && strings.EqualFold(fields[0], hex.EncodeToString(localHash[:]))
}

func requireFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("required agent artifact %q: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("required agent artifact %q is not a regular file", path)
	}
	return nil
}

func supportedAndroidABI(abi string) bool {
	switch abi {
	case "arm64-v8a", "armeabi-v7a", "x86", "x86_64":
		return true
	default:
		return false
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
		AudioPackets:   audioPacketCount.Load(),
		LastVideoPTS:   lastVideoPTS.Load(),
	}
	channelStatusMu.RUnlock()
	agentControlMu.Lock()
	status.ControlConnected = agentControl != nil
	agentControlMu.Unlock()
	agentStateMu.RLock()
	status.AgentStarting = agentStarting
	status.AgentStarted = agentStarted
	status.AgentError = agentStartError
	agentStateMu.RUnlock()
	audioMu.Lock()
	status.AudioConfigured = len(audioConfig) != 0
	audioMu.Unlock()
	w.Header().Set("Access-Control-Allow-Origin", "*")
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

func displayStateHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
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
