package server

import (
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"control_server/internal/agent"
	"control_server/internal/codec"
	"control_server/internal/device"
)

//go:embed web/index.html
var indexFiles embed.FS

func Run() {
	httpAddress := flag.String("http", HTTP_ADDR, "HTTP listen address")
	socketAddress := flag.String("socket", SOCKET_ADDR, "agent TCP listen address")
	distDir := flag.String("dist-dir", "dist", "directory containing the agent archive and native libraries")
	deviceSerial := flag.String("device-serial", "", "Android device serial; installs and starts the agent after listeners are ready")
	testWebServer := flag.Bool("test-webserver", false, "serve the standalone HTML test page at /")
	adbPath := flag.String("adb", "adb", "path to adb")
	bitRate := flag.Int("bit-rate", 10000000, "agent AVC bit rate in bits per second")
	flag.IntVar(&jpegQuality, "jpeg-quality", 95, "MJPEG quality (1-100)")
	flag.Parse()
	if jpegQuality < 1 || jpegQuality > 100 {
		log.Fatal("JPEG quality must be between 1 and 100")
	}
	log.Printf("JPEG encoder: %s (quality %d)", codec.JPEGEncoderName, jpegQuality)

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
	device := device.New(*adbPath, *deviceSerial)
	if *testWebServer {
		assets, err := fs.Sub(indexFiles, "web")
		if err != nil {
			log.Fatal(err)
		}
		mux.Handle("/", http.FileServer(http.FS(assets)))
	}
	mux.HandleFunc("/stream", mjpegHandler)
	mux.HandleFunc("/control", controlWebSocketHandler)
	mux.HandleFunc("/audio", audioWebSocketHandler)
	mux.HandleFunc("/api/display-state", displayStateHandler)
	mux.HandleFunc("/api/status", serverStatusHandler)
	mux.HandleFunc("/api/performance", performanceHandler)
	mux.HandleFunc("/api/resources", resourcesHandler)
	mux.HandleFunc("/api/volume", device.VolumeHandler)

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
		config := agent.Config{
			ADBPath:       *adbPath,
			Serial:        *deviceSerial,
			DistDir:       *distDir,
			SocketName:    "screen-sharing-agent",
			SocketAddress: *socketAddress,
			BitRate:       *bitRate,
			ChannelsReady: agentChannelsReady,
		}
		setAgentState(true, false, "")
		go func() {
			if err := agent.Start(shutdownContext, config); err != nil {
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
