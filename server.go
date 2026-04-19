package main

import (
	"bufio"
	"bytes"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sync"
)

const (
	SOCKET_ADDR = ":5050"
	HTTP_ADDR   = ":8080"
	BOUNDARY    = "frame"
)

var (
	clients   = make(map[chan []byte]bool)
	clientsMu sync.Mutex
)

// ================= MAIN =================

func main() {
	log.Println("🌍 http://localhost" + HTTP_ADDR)
	log.Println("📡 listening", SOCKET_ADDR)

	go startTCP()

	// Serve static files from current directory
	fs := http.FileServer(http.Dir("."))

	http.Handle("/", fs)
	http.HandleFunc("/stream", mjpegHandler)

	log.Fatal(http.ListenAndServe(HTTP_ADDR, nil))
}

// ================= TCP ACCEPT =================

func startTCP() {
	ln, err := net.Listen("tcp", SOCKET_ADDR)
	if err != nil {
		panic(err)
	}

	for {
		conn, err := ln.Accept()
		if err != nil {
			continue
		}

		go handleConn(conn)
	}
}

func handleConn(conn net.Conn) {
	reader := bufio.NewReader(conn)

	marker, err := reader.ReadByte()
	if err != nil {
		conn.Close()
		return
	}

	switch marker {
	case 'V':
		log.Println("📹 VIDEO channel")
		handleVideo(conn, reader)

	case 'A':
		log.Println("🎧 AUDIO ignored")
		io.Copy(io.Discard, reader)
		conn.Close()

	case 'C':
		log.Println("🎮 CONTROL ignored")
		io.Copy(io.Discard, reader)
		conn.Close()

	default:
		log.Println("❓ unknown channel:", string(marker))
		conn.Close()
	}
}

// ================= VIDEO PIPE =================
func handleVideo(conn net.Conn, r *bufio.Reader) {
	defer conn.Close()

	// 1. Skip codec header (20 bytes)
	header := make([]byte, 20)
	if _, err := io.ReadFull(r, header); err != nil {
		return
	}

	// 2. Refined FFmpeg Command
	cmd := exec.Command(
		"ffmpeg",
		"-loglevel", "quiet",
		"-probesize", "32",          // Minimal probe for low latency
		"-analyzeduration", "0",
		"-f", "h264",                // Tell ffmpeg it's raw H264
		"-i", "pipe:0",
		"-vf", "fps=30",             // Match device fps if possible
		"-f", "mpjpeg",              // MPJPEG is better for streaming
		"-q:v", "5",                 // Quality 1-31
		"pipe:1",
	)

	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	cmd.Start()

	// Forward video data to FFmpeg
	go func() {
		defer stdin.Close()
		io.Copy(stdin, r)
	}()

	// Since we used "-f mpjpeg", FFmpeg handles the boundary.
	// We can simplify readMJPEG to just look for JPEG markers 
    // or just pipe stdout directly to the broadcast.
	readMJPEG(stdout)
}

func readMJPEG(r io.Reader) {
	// Use a scanner with a custom split function or a simple buffer
	scanner := bufio.NewScanner(r)
	
	// Adjust buffer size for large JPEG frames
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 1024*1024)

	// Custom split function to find JPEG frames
	// However, for simplicity, let's stick to your index method but 
    // ensure we don't drop data.
	fullBuf := new(bytes.Buffer)
	tmp := make([]byte, 4096)
	for {
		n, err := r.Read(tmp)
		if err != nil { return }
		fullBuf.Write(tmp[:n])

		for {
			data := fullBuf.Bytes()
			start := bytes.Index(data, []byte{0xFF, 0xD8})
			end := bytes.Index(data, []byte{0xFF, 0xD9})

			if start != -1 && end != -1 && end > start {
				frame := make([]byte, end-start+2)
				copy(frame, data[start:end+2])
				broadcast(frame)
				
				// Keep remaining data in the buffer
				fullBuf.Next(end + 2)
			} else {
				break
			}
		}
	}
}

// ================= BROADCAST =================

func broadcast(frame []byte) {
	clientsMu.Lock()
	defer clientsMu.Unlock()

	for ch := range clients {
		select {
		case ch <- frame:
		default:
		}
	}
}

// ================= HTTP =================

func mjpegHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("🌐 browser connected")

	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+BOUNDARY)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no stream", 500)
		return
	}

	ch := make(chan []byte, 20)

	clientsMu.Lock()
	clients[ch] = true
	clientsMu.Unlock()

	defer func() {
		clientsMu.Lock()
		delete(clients, ch)
		clientsMu.Unlock()
	}()

	for frame := range ch {
		w.Write([]byte("--" + BOUNDARY + "\r\n"))
		w.Write([]byte("Content-Type: image/jpeg\r\n\r\n"))
		w.Write(frame)
		w.Write([]byte("\r\n"))
		flusher.Flush()
	}
}

// ================= INDEX =================

func indexHandler(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile("index.html")
	if err != nil {
		http.Error(w, "missing index.html", 500)
		return
	}
	w.Write(data)
}