package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"

	"control_server/internal/diagnostics"
)

func TestResourceSnapshotReportsCurrentProcessAndHeap(t *testing.T) {
	response := httptest.NewRecorder()
	resourcesHandler(response, httptest.NewRequest("GET", "/api/resources", nil))
	var stats diagnostics.RuntimeStats
	if err := json.Unmarshal(response.Body.Bytes(), &stats); err != nil {
		t.Fatal(err)
	}
	if stats.PID != os.Getpid() || stats.Goroutines < 1 || stats.HeapAlloc == 0 || stats.HeapInuse < stats.HeapAlloc {
		t.Fatalf("invalid runtime snapshot: %+v", stats)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("runtime snapshots must not be cached")
	}
	if stats.SampledAtMS <= 0 {
		t.Fatal("resource snapshot must include its sample time")
	}
	if stats.CPUTimeNS != nil && *stats.CPUTimeNS == 0 {
		t.Fatal("process CPU time must include work already performed")
	}
}
