package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestDescribeParsesDurationsWithoutContactingServer(t *testing.T) {
	var output bytes.Buffer
	if err := run(context.Background(), []string{"--describe", "--duration", "1m2s", "--warmup", "250ms"}, &output); err != nil {
		t.Fatal(err)
	}
	var timing map[string]int64
	if err := json.Unmarshal(output.Bytes(), &timing); err != nil || timing["durationMs"] != 62000 || timing["warmupMs"] != 250 {
		t.Fatalf("unexpected timing: %s (%v)", output.Bytes(), err)
	}
}

func TestInvalidOptionsFailBeforeSampling(t *testing.T) {
	for _, args := range [][]string{{"--duration", "0s"}, {"--warmup", "-1s"}, {"--interval", "1ms"}, {"--fps", "241"}, {"--transport", "invalid"}, {"--touch-latency", "--replay", "unused"}, {"--url", "file:///tmp/server"}} {
		if err := run(context.Background(), args, &bytes.Buffer{}); err == nil {
			t.Fatalf("accepted invalid options: %v", args)
		}
	}
}

func TestQuietStreamHasBoundedWindowAndFailsFPSTarget(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer connection.Close()
		_, _, _ = connection.ReadMessage()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var output bytes.Buffer
	started := time.Now()
	err := run(ctx, []string{"--url", server.URL, "--pid", strconv.Itoa(os.Getpid()), "--duration", "300ms", "--warmup", "0s", "--interval", "100ms", "--assert-target"}, &output)
	if err == nil || err.Error() != "frame consistency target failed" {
		t.Fatalf("unexpected error: %v", err)
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("quiet stream outlived measurement window")
	}
	var result struct {
		Video     frameReport
		Resources report
	}
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Video.FPS != 0 || result.Resources.Samples < 2 {
		t.Fatalf("unexpected report: %s", output.Bytes())
	}
}

func TestLatencySummaryDoesNotMutateSamples(t *testing.T) {
	values := []float64{9, 1, 5}
	result := summarize(values)
	if result.Mean != 5 || result.P50 != 5 || result.P95 != 9 || !reflect.DeepEqual(values, []float64{9, 1, 5}) {
		t.Fatalf("unexpected summary: %+v %v", result, values)
	}
}
