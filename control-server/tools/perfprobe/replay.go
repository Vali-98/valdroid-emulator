package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

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

func replay(ctx context.Context, address string, units [][]byte, width, height, fps int, clock *replayClock) error {
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
		clock.sent(uint32(frame + 1))
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
