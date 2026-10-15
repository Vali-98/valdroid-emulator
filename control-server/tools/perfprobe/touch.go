package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type touchProbe struct {
	mu                          sync.Mutex
	start                       time.Time
	frames                      chan frame
	done                        chan struct{}
	workerDone                  chan struct{}
	ready                       chan int
	seen                        chan int
	sequence                    int
	expected                    int
	sent                        time.Time
	requestID                   string
	visible, roundTrip, forward []float64
}

func markerSequence(pixels image.Image) (int, bool) {
	bounds := pixels.Bounds()
	step := bounds.Dy() / 300
	if step < 1 {
		step = 1
	}
	for y := bounds.Min.Y; y < bounds.Min.Y+bounds.Dy()/3; y += step {
		if sequence, valid := markerRow(pixels, y); valid {
			return sequence, true
		}
	}
	return 0, false
}

func markerRow(pixels image.Image, y int) (int, bool) {
	bounds := pixels.Bounds()
	sequence := 0
	for cell := 0; cell < 20; cell++ {
		x := bounds.Min.X + int((.1+(.8*(float64(cell)+.5)/20))*float64(bounds.Dx()))
		r, g, b, _ := pixels.At(x, y).RGBA()
		green := r < 100*257 && g > 150*257 && b < 100*257
		blue := r < 100*257 && b > 150*257 && g < 100*257
		if !green && !blue {
			return 0, false
		}
		if cell < 4 {
			if green != (cell%2 == 0) {
				return 0, false
			}
			continue
		}
		if green {
			sequence |= 1 << (cell - 4)
		}
	}
	return sequence, true
}

func newTouchProbe(start time.Time) *touchProbe {
	probe := &touchProbe{start: start, frames: make(chan frame, 1), done: make(chan struct{}), workerDone: make(chan struct{}), ready: make(chan int, 1), seen: make(chan int, 1), sequence: -1, expected: -1}
	go func() {
		defer close(probe.workerDone)
		for {
			select {
			case <-probe.done:
				return
			case frame := <-probe.frames:
				probe.mu.Lock()
				needed := probe.sequence < 0 || probe.expected >= 0
				probe.mu.Unlock()
				if !needed {
					continue
				}
				pixels, err := jpeg.Decode(bytes.NewReader(frame.jpeg))
				if err != nil {
					continue
				}
				sequence, valid := markerSequence(pixels)
				if !valid {
					continue
				}
				probe.mu.Lock()
				if probe.sequence < 0 {
					probe.sequence = sequence
					probe.ready <- sequence
				}
				if sequence == probe.expected && !frame.received.Before(probe.sent) {
					if !probe.sent.Before(probe.start) {
						probe.visible = append(probe.visible, float64(frame.received.Sub(probe.sent))/float64(time.Millisecond))
					}
					probe.expected = -1
					probe.sequence = sequence
					probe.seen <- sequence
				}
				probe.mu.Unlock()
			}
		}
	}()
	return probe
}

func (probe *touchProbe) observe(frame frame) {
	select {
	case probe.frames <- frame:
	default:
		select {
		case <-probe.frames:
		default:
		}
		select {
		case probe.frames <- frame:
		default:
		}
	}
}
func (probe *touchProbe) close() { close(probe.done); <-probe.workerDone }
func (probe *touchProbe) snapshot() any {
	probe.mu.Lock()
	defer probe.mu.Unlock()
	return struct {
		Scope          string  `json:"scope"`
		TouchToFrame   summary `json:"touchToReceivedFrame"`
		InputRoundTrip summary `json:"inputRoundTrip"`
		ServerForward  summary `json:"serverForward"`
	}{"Host send to observed fixture response at the probe; excludes browser decode/compositor/display. ACK ends at the server's agent socket write, not Android injection.", summarize(probe.visible), summarize(probe.roundTrip), summarize(probe.forward)}
}

func (probe *touchProbe) run(ctx context.Context, base string) error {
	baseline := time.NewTimer(3 * time.Second)
	defer baseline.Stop()
	var sequence int
	select {
	case sequence = <-probe.ready:
	case <-ctx.Done():
		return nil
	case <-baseline.C:
		return errors.New("frame-clock latency marker not found; launch the dedicated fixture")
	}
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/api/display-state", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	var display struct{ Width, Height int32 }
	err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&display)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK || display.Width < 1 || display.Height < 1 {
		return errors.New("display dimensions unavailable for touch probe")
	}
	connection, _, err := websocket.DefaultDialer.DialContext(ctx, "ws"+strings.TrimPrefix(strings.TrimRight(base, "/"), "http")+"/control", nil)
	if err != nil {
		return err
	}
	stop := closeOnCancel(ctx, connection)
	defer stop()
	readerDone := make(chan struct{})
	inputErrors := make(chan error, 1)
	go func() {
		defer close(readerDone)
		for {
			var reply struct {
				Type, RequestID, Error string
				ServerForwardUS        int64
			}
			if err := connection.ReadJSON(&reply); err != nil {
				return
			}
			if reply.Error != "" {
				inputErrors <- errors.New(reply.Error)
				return
			}
			probe.mu.Lock()
			if reply.Type == "input-ack" && reply.RequestID == probe.requestID && !probe.sent.Before(probe.start) {
				probe.roundTrip = append(probe.roundTrip, float64(time.Since(probe.sent))/float64(time.Millisecond))
				probe.forward = append(probe.forward, float64(reply.ServerForwardUS)/1000)
			}
			probe.mu.Unlock()
		}
	}()
	defer func() { _ = connection.Close(); <-readerDone }()
	for ctx.Err() == nil {
		sequence = (sequence + 1) & 65535
		probe.mu.Lock()
		probe.expected = sequence
		probe.sent = time.Now()
		probe.requestID = fmt.Sprintf("touch-%d", sequence)
		requestID := probe.requestID
		probe.mu.Unlock()
		for _, action := range []int{0, 1} {
			message := map[string]any{"type": "motion", "action": action, "displayId": 0, "isMouse": false, "pointers": []map[string]any{{"id": 0, "x": display.Width / 2, "y": display.Height / 2}}}
			if action == 0 {
				message["requestId"] = requestID
			}
			_ = connection.SetWriteDeadline(time.Now().Add(time.Second))
			if err := connection.WriteJSON(message); err != nil {
				if ctx.Err() != nil {
					return nil
				}
				return err
			}
		}
		timeout := time.NewTimer(2 * time.Second)
		select {
		case <-ctx.Done():
			timeout.Stop()
			return nil
		case err := <-inputErrors:
			timeout.Stop()
			return err
		case <-probe.seen:
			timeout.Stop()
		case <-timeout.C:
			return errors.New("touch response was not observed within two seconds")
		}
		delay := time.NewTimer(500 * time.Millisecond)
		select {
		case <-ctx.Done():
			delay.Stop()
			return nil
		case <-delay.C:
		}
	}
	return nil
}
