// frameprobe measures received MJPEG pacing, with optional paced AVC replay/input.
package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type summary struct {
	Mean float64 `json:"meanMs"`
	P50  float64 `json:"p50Ms"`
	P95  float64 `json:"p95Ms"`
	P99  float64 `json:"p99Ms"`
	Max  float64 `json:"maxMs"`
}

func summarize(values []float64) summary {
	if len(values) == 0 {
		return summary{}
	}
	values = append([]float64(nil), values...)
	sort.Float64s(values)
	var sum float64
	for _, v := range values {
		sum += v
	}
	return summary{sum / float64(len(values)), values[(len(values)-1)/2], values[(len(values)-1)*95/100], values[(len(values)-1)*99/100], values[len(values)-1]}
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	base := flag.String("url", "http://127.0.0.1:38475", "server base URL")
	duration := flag.Duration("duration", 20*time.Second, "measurement window")
	warmup := flag.Duration("warmup", 2*time.Second, "warmup before measurement")
	replayFile := flag.String("replay", "", "optional Annex-B AVC fixture containing AUD NAL units")
	agent := flag.String("agent", "127.0.0.1:38476", "agent TCP address for replay")
	width := flag.Int("width", 1080, "replay display width")
	height := flag.Int("height", 2400, "replay display height")
	fps := flag.Int("fps", 60, "replay cadence / target FPS")
	interact := flag.Bool("exercise-input", false, "send repeated vertical swipes through the control websocket")
	assertTarget := flag.Bool("assert-target", false, "fail below 98% target FPS, on nonmonotonic PTS, or on p95 gaps over 1.5 frame periods")
	flag.Parse()
	if *duration <= 0 || *warmup < 0 || *fps <= 0 || *fps > 240 || *width <= 0 || *height <= 0 {
		return errors.New("invalid measurement parameters")
	}
	parsedURL, err := url.Parse(*base)
	if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return errors.New("url must be an absolute HTTP(S) server URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *duration+*warmup+3*time.Second)
	defer cancel()
	var background sync.WaitGroup
	backgroundErrors := make(chan error, 2)
	if *replayFile != "" {
		data, err := os.ReadFile(*replayFile)
		if err != nil {
			return err
		}
		units, err := accessUnits(data)
		if err != nil {
			return err
		}
		background.Add(1)
		go func() { defer background.Done(); backgroundErrors <- replay(ctx, *agent, units, *width, *height, *fps) }()
	}
	if *interact {
		background.Add(1)
		go func() { defer background.Done(); backgroundErrors <- exerciseInput(ctx, *base) }()
	}
	defer background.Wait()
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(*base, "/")+"/stream", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("stream HTTP status: %d", response.StatusCode)
	}
	_, parameters, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil {
		return err
	}
	reader := multipart.NewReader(response.Body, parameters["boundary"])
	if parameters["boundary"] == "" {
		return errors.New("stream response has no multipart boundary")
	}
	measureAfter := time.Now().Add(*warmup)
	measureUntil := measureAfter.Add(*duration)
	var last time.Time
	var previousPTS int64
	var intervals, sourceIntervals, processing []float64
	frames, invalidPTS := 0, 0
	var bytesReceived int64
	for time.Now().Before(measureUntil) {
		part, err := reader.NextPart()
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			return err
		}
		size, err := strconv.ParseInt(part.Header.Get("Content-Length"), 10, 64)
		if err != nil || size <= 0 || size > 64<<20 {
			return errors.New("invalid JPEG size")
		}
		if _, err := io.CopyN(io.Discard, part, size); err != nil {
			return err
		}
		now := time.Now()
		if now.Before(measureAfter) {
			continue
		}
		if now.After(measureUntil) {
			break
		}
		pts, _ := strconv.ParseInt(part.Header.Get("X-Presentation-Timestamp-Us"), 10, 64)
		if !last.IsZero() {
			intervals = append(intervals, float64(now.Sub(last))/float64(time.Millisecond))
			if pts <= previousPTS {
				invalidPTS++
			} else {
				sourceIntervals = append(sourceIntervals, float64(pts-previousPTS)/1000)
			}
		}
		if value, err := strconv.ParseFloat(part.Header.Get("X-Server-Processing-Us"), 64); err == nil {
			processing = append(processing, value/1000)
		}
		last, previousPTS = now, pts
		frames++
		bytesReceived += size
	}
	// Include silence in the fixed measurement window, not just first-to-last frame time.
	measuredFPS := float64(frames) / duration.Seconds()
	gap := summarize(intervals)
	result := struct {
		Frames           int             `json:"frames"`
		FPS              float64         `json:"fps"`
		Bytes            int64           `json:"jpegBytes"`
		NonmonotonicPTS  int             `json:"nonmonotonicPTS"`
		ReceiveIntervals summary         `json:"receiveIntervals"`
		SourceIntervals  summary         `json:"sourceIntervals"`
		ServerProcessing summary         `json:"serverProcessing"`
		Server           json.RawMessage `json:"server,omitempty"`
	}{Frames: frames, FPS: measuredFPS, Bytes: bytesReceived, NonmonotonicPTS: invalidPTS, ReceiveIntervals: gap, SourceIntervals: summarize(sourceIntervals), ServerProcessing: summarize(processing)}
	client := &http.Client{Timeout: 3 * time.Second}
	if status, err := client.Get(strings.TrimRight(*base, "/") + "/api/performance"); err == nil {
		data, readErr := io.ReadAll(io.LimitReader(status.Body, 1<<20))
		status.Body.Close()
		if readErr == nil && status.StatusCode == http.StatusOK {
			result.Server = data
		}
	}
	output := json.NewEncoder(os.Stdout)
	output.SetIndent("", "  ")
	if err := output.Encode(result); err != nil {
		return err
	}
	select {
	case err := <-backgroundErrors:
		if err != nil && ctx.Err() == nil {
			return err
		}
	default:
	}
	if *assertTarget && (measuredFPS < float64(*fps)*.98 || invalidPTS != 0 || gap.P95 > 1500/float64(*fps)) {
		return errors.New("frame consistency target failed")
	}
	return nil
}

func accessUnits(data []byte) ([][]byte, error) {
	var starts []int
	for i := 0; i+4 < len(data); i++ {
		prefix := 0
		if bytes.Equal(data[i:i+4], []byte{0, 0, 0, 1}) {
			prefix = 4
		} else if bytes.Equal(data[i:i+3], []byte{0, 0, 1}) {
			prefix = 3
		}
		if prefix != 0 && data[i+prefix]&31 == 9 {
			starts = append(starts, i)
		}
		if prefix != 0 {
			i += prefix - 1
		}
	}
	if len(starts) == 0 {
		return nil, errors.New("fixture must contain access-unit delimiters; generate with ffmpeg -bsf:v h264_metadata=aud=insert")
	}
	starts[0] = 0
	var result [][]byte
	for i, start := range starts {
		end := len(data)
		if i+1 < len(starts) {
			end = starts[i+1]
		}
		result = append(result, data[start:end])
	}
	return result, nil
}

func replay(ctx context.Context, address string, units [][]byte, width, height, fps int) error {
	connection, err := (&net.Dialer{}).DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer connection.Close()
	stop := closeOnCancel(ctx, connection)
	defer stop()
	codec := make([]byte, 21)
	codec[0] = 'V'
	copy(codec[1:], "avc")
	if err := writeAll(connection, codec); err != nil {
		return err
	}
	started := time.Now()
	for frame := 0; ; frame++ {
		if ctx.Err() != nil {
			return nil
		}
		payload := units[frame%len(units)]
		var header [44]byte
		binary.LittleEndian.PutUint32(header[4:8], uint32(width))
		binary.LittleEndian.PutUint32(header[8:12], uint32(height))
		binary.LittleEndian.PutUint32(header[20:24], uint32(frame+1))
		binary.LittleEndian.PutUint64(header[32:40], uint64(1000000+frame*1000000/fps))
		binary.LittleEndian.PutUint32(header[40:44], uint32(len(payload)))
		if err := writeAll(connection, header[:]); err != nil {
			return err
		}
		if err := writeAll(connection, payload); err != nil {
			return err
		}
		timer := time.NewTimer(time.Until(started.Add(time.Duration(frame+1) * time.Second / time.Duration(fps))))
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}
func writeAll(w io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := w.Write(data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

func exerciseInput(ctx context.Context, base string) error {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/api/display-state", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("display-state HTTP status: %d", response.StatusCode)
	}
	var display struct{ Width, Height int32 }
	if err := json.NewDecoder(response.Body).Decode(&display); err != nil {
		return err
	}
	if display.Width <= 0 || display.Height <= 0 {
		return errors.New("display dimensions unavailable for input exercise")
	}
	socketURL := "ws" + strings.TrimPrefix(strings.TrimRight(base, "/"), "http") + "/control"
	connection, _, err := websocket.DefaultDialer.DialContext(ctx, socketURL, nil)
	if err != nil {
		return err
	}
	readDone := make(chan struct{})
	inputErrors := make(chan error, 1)
	go func() {
		defer close(readDone)
		for {
			var message struct {
				Error string `json:"error"`
			}
			if err := connection.ReadJSON(&message); err != nil {
				inputErrors <- err
				return
			}
			if message.Error != "" {
				inputErrors <- fmt.Errorf("control input rejected: %s", message.Error)
				return
			}
		}
	}()
	defer func() { _ = connection.Close(); <-readDone }()
	stop := closeOnCancel(ctx, connection)
	defer stop()
	for ctx.Err() == nil {
		for index := 0; index <= 30; index++ {
			select {
			case err := <-inputErrors:
				return err
			default:
			}
			action := 2
			if index == 0 {
				action = 0
			}
			if index == 30 {
				action = 1
			}
			message := map[string]any{"type": "motion", "action": action, "pointers": []map[string]any{{"id": 0, "x": display.Width / 2, "y": display.Height*3/4 - int32(index)*display.Height/60}}, "displayId": 0, "isMouse": false}
			_ = connection.SetWriteDeadline(time.Now().Add(time.Second))
			if err := connection.WriteJSON(message); err != nil {
				return err
			}
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(time.Second / 120):
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(time.Second):
		}
	}
	return nil
}

func closeOnCancel(ctx context.Context, connection io.Closer) func() {
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = connection.Close()
		case <-done:
		}
	}()
	return func() { close(done) }
}
