package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"

	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"control_server/internal/codec"
)

func TestClientQueueRetainsNewestFrame(t *testing.T) {
	client := &streamClient{displayID: 9001, frames: make(chan streamFrame, 1)}
	clientsMu.Lock()
	clients[client] = struct{}{}
	clientsMu.Unlock()
	t.Cleanup(func() {
		clientsMu.Lock()
		delete(clients, client)
		delete(latestFrames, 9001)
		clientsMu.Unlock()
		metricsRegistry.Lock()
		delete(metricsRegistry.displays, 9001)
		metricsRegistry.Unlock()
	})
	for i := int64(1); i <= 5; i++ {
		broadcast(streamFrame{displayID: 9001, presentationUS: i, jpeg: []byte{byte(i)}})
	}
	if got := (<-client.frames).presentationUS; got != 5 {
		t.Fatalf("stale frame %d delivered", got)
	}
	if got := metricsFor(9001).snapshot(9001).ClientDrops; got != 4 {
		t.Fatalf("dropped count = %d, want 4", got)
	}
}

func TestDecodedQueueDropsStaleFramesAndOwnsPixels(t *testing.T) {
	const display = 9003
	t.Cleanup(func() {
		metricsRegistry.Lock()
		delete(metricsRegistry.displays, display)
		metricsRegistry.Unlock()
	})
	queue := make(chan decodedFrame, 1)
	first := image.NewRGBA(image.Rect(0, 0, 2, 1))
	sendLatestFrame(queue, decodedFrame{metadata: streamFrame{displayID: display, frameNumber: 1}, pixels: first})
	second := image.NewRGBA(image.Rect(0, 0, 1, 2))
	sendLatestFrame(queue, decodedFrame{metadata: streamFrame{displayID: display, frameNumber: 2}, pixels: second})
	latest := <-queue
	defer codec.ReleaseFrame(latest.pixels)
	if latest.metadata.frameNumber != 2 || latest.pixels != second || latest.pixels.Rect != image.Rect(0, 0, 1, 2) {
		t.Fatal("queue retained stale frame or stale image dimensions")
	}
	if got := metricsFor(display).snapshot(display).EncodeDrops; got != 1 {
		t.Fatalf("encode drops = %d, want 1", got)
	}
}

func TestCachedFrameDoesNotReportIdleTimeAsProcessing(t *testing.T) {
	frame := streamFrame{cached: true, receivedAt: time.Now().Add(-time.Hour)}
	if bytes.Contains(appendFrameHeader(nil, frame), []byte("X-Server-Processing")) {
		t.Fatal("idle cached frame was reported as server processing latency")
	}
}

type failedStreamWriter struct {
	*httptest.ResponseRecorder
	deadline time.Time
}

func (w *failedStreamWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadline = deadline
	return nil
}
func (w *failedStreamWriter) FlushError() error { return errors.New("viewer disconnected") }

func TestMJPEGDisconnectRemovesSubscriberAndSetsDeadline(t *testing.T) {
	const display = 9004
	broadcast(streamFrame{displayID: display, jpeg: []byte{1, 2, 3}})
	t.Cleanup(func() { clientsMu.Lock(); delete(latestFrames, display); clientsMu.Unlock() })
	writer := &failedStreamWriter{ResponseRecorder: httptest.NewRecorder()}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	request := httptest.NewRequest(http.MethodGet, "/stream?display=9004", nil).WithContext(ctx)
	mjpegHandler(writer, request)
	if writer.deadline.Before(time.Now()) || writer.deadline.After(time.Now().Add(3*time.Second)) {
		t.Fatalf("stream did not apply a bounded write deadline: %s", writer.deadline)
	}
	clientsMu.Lock()
	defer clientsMu.Unlock()
	for client := range clients {
		if client.displayID == display {
			t.Fatal("disconnected subscriber leaked")
		}
	}
}

func TestMJPEGReplaysCachedFrameWithoutNewAgentFrame(t *testing.T) {
	frame := streamFrame{displayID: 9002, displayWidth: 1080, displayHeight: 2400, frameNumber: 12, presentationUS: 1234, jpeg: []byte{0xff, 0xd8, 0xff, 0xd9}}
	broadcast(frame)
	t.Cleanup(func() { clientsMu.Lock(); delete(latestFrames, 9002); clientsMu.Unlock() })
	server := httptest.NewServer(http.HandlerFunc(mjpegHandler))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"?display=9002", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	_, params, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	part, err := multipart.NewReader(response.Body, params["boundary"]).NextPart()
	if err != nil {
		t.Fatal(err)
	}
	data := make([]byte, len(frame.jpeg))
	if _, err := io.ReadFull(part, data); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, frame.jpeg) || part.Header.Get("X-Frame-Number") != "12" {
		t.Fatal("cached frame or its metadata was corrupted")
	}
}

func TestPerformanceWindowsAndJSON(t *testing.T) {
	var window durationWindow
	for i := 0; i < 700; i++ {
		window.add(time.Duration(i) * time.Millisecond)
	}
	stats := window.summary()
	if stats.Samples != 600 || stats.P95MS != 669 || stats.MaxMS != 699 {
		t.Fatalf("unexpected rolling summary: %+v", stats)
	}
	metrics := &videoMetrics{}
	now := time.Now()
	metrics.receive(now, 1000)
	metrics.receive(now.Add(time.Second/60), 17667)
	result := metrics.snapshot(0)
	if result.InputFrames != 2 || result.SourceIntervals.P95MS != 16.667 {
		t.Fatalf("bad source statistics: %+v", result)
	}
	if _, err := json.Marshal(result); err != nil {
		t.Fatal(err)
	}
}

func TestDisplayQueryValidation(t *testing.T) {
	for _, value := range []string{"-1", "oops", "2147483648"} {
		request := httptest.NewRequest(http.MethodGet, "/stream?display="+value, nil)
		if _, err := requestedDisplay(request); err == nil {
			t.Errorf("accepted invalid display %q", value)
		}
	}
}
