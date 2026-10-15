package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCPUAccountingIncludesMultipleCoresAndWeightsElapsedTime(t *testing.T) {
	start := time.Now()
	samples := []sample{{start, 10, 100 << 20}, {start.Add(time.Second), 12, 120 << 20}, {start.Add(3 * time.Second), 13, 110 << 20}}
	r, err := summarizeSamples(123, "fixture", samples)
	if err != nil {
		t.Fatal(err)
	}
	if r.CPUPercent.Mean != 100 || r.CPUPercent.Max != 200 || r.RSSMiB.Max != 120 || r.RSSDeltaMiB != 10 {
		t.Fatalf("unexpected process accounting: %+v", r)
	}
}

func TestPIDDiscoveryUsesLocalServerAndRejectsRedirects(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resources" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		fmt.Fprint(w, `{"pid":123,"heapAllocBytes":456}`)
	}))
	defer server.Close()
	pid, err := discoverPID(server.URL)
	if err != nil || pid != 123 {
		t.Fatalf("discovery failed: %d, %v", pid, err)
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, server.URL, http.StatusFound) }))
	defer redirect.Close()
	if _, err := discoverPID(redirect.URL); err == nil {
		t.Fatal("followed a redirect instead of validating the process source")
	}
}

func TestPIDDiscoveryRejectsRemoteOrInvalidURLs(t *testing.T) {
	for _, address := range []string{"https://example.com", "file:///tmp/server", "http://[::", "http://0.0.0.0:8080"} {
		if _, err := discoverPID(address); err == nil {
			t.Errorf("accepted non-local server: %s", address)
		}
	}
}

func TestRejectsInvalidProcessSamples(t *testing.T) {
	now := time.Now()
	for _, samples := range [][]sample{nil, {{at: now}}, {{at: now, cpuSeconds: 2}, {at: now.Add(time.Second), cpuSeconds: 1}}, {{at: now}, {at: now}}} {
		if _, err := summarizeSamples(1, "", samples); err == nil {
			t.Fatal("accepted invalid samples")
		}
	}
}
