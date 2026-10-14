package main

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestAccessUnitsPreserveConfigurationAndMixedPrefixes(t *testing.T) {
	configuration := []byte{0, 0, 0, 1, 0x67, 0x12, 0, 0, 1, 0x68, 0x34}
	first := []byte{0, 0, 0, 1, 9, 0xf0, 0, 0, 1, 0x65, 0x56}
	second := []byte{0, 0, 1, 9, 0xf0, 0, 0, 0, 1, 0x41, 0x78}
	fixture := append(append(append([]byte(nil), configuration...), first...), second...)
	units, err := accessUnits(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 2 || !bytes.Equal(units[0], fixture[:len(configuration)+len(first)]) || !bytes.Equal(units[1], second) {
		t.Fatalf("incorrect frame boundaries: %x", units)
	}
}

func TestAccessUnitsRequireDelimiters(t *testing.T) {
	if _, err := accessUnits([]byte{0, 0, 1, 0x65, 1}); err == nil {
		t.Fatal("accepted fixture without access-unit delimiters")
	}
}

func TestSummarizeDoesNotMutateSamples(t *testing.T) {
	samples := []float64{3, 1, 2}
	stats := summarize(samples)
	if stats.Mean != 2 || stats.P50 != 2 || stats.Max != 3 || samples[0] != 3 {
		t.Fatalf("incorrect summary or mutated samples: %+v, %v", stats, samples)
	}
}

type partialWriter struct{ bytes.Buffer }

func (w *partialWriter) Write(data []byte) (int, error) {
	if len(data) > 2 {
		data = data[:2]
	}
	return w.Buffer.Write(data)
}

type zeroWriter struct{}

func (zeroWriter) Write([]byte) (int, error) { return 0, nil }

func TestWriteAllHandlesShortWrites(t *testing.T) {
	writer := &partialWriter{}
	if err := writeAll(writer, []byte("abcdef")); err != nil || writer.String() != "abcdef" {
		t.Fatalf("short write handling failed: %q, %v", writer.String(), err)
	}
	if err := writeAll(zeroWriter{}, []byte{1}); err != io.ErrShortWrite {
		t.Fatalf("zero write error = %v", err)
	}
}

func TestInputExerciseReportsRejectedCommands(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/display-state", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"width":1080,"height":2400}`)
	})
	mux.HandleFunc("/control", func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		connection, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer connection.Close()
		if _, _, err := connection.ReadMessage(); err == nil {
			_ = connection.WriteJSON(map[string]string{"error": "agent is disconnected"})
		}
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := exerciseInput(ctx, server.URL); err == nil || !strings.Contains(err.Error(), "agent is disconnected") {
		t.Fatalf("input failure was not reported: %v", err)
	}
}
