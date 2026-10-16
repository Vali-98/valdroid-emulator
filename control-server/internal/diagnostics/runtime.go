package diagnostics

import (
	"os"
	"runtime"
	"time"
)

type RuntimeStats struct {
	PID         int     `json:"pid"`
	Goroutines  int     `json:"goroutines"`
	HeapAlloc   uint64  `json:"heapAllocBytes"`
	HeapInuse   uint64  `json:"heapInuseBytes"`
	HeapSys     uint64  `json:"heapReservedBytes"`
	TotalAlloc  uint64  `json:"totalAllocBytes"`
	GCCycles    uint32  `json:"gcCycles"`
	GCPauseNS   uint64  `json:"gcPauseTotalNs"`
	CgoCalls    int64   `json:"cgoCalls"`
	CPUTimeNS   *uint64 `json:"cpuTimeNs,omitempty"`
	SampledAtMS int64   `json:"sampledAtMs"`
}

func Snapshot() RuntimeStats {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	return RuntimeStats{
		PID: os.Getpid(), Goroutines: runtime.NumGoroutine(), HeapAlloc: memory.HeapAlloc,
		HeapInuse: memory.HeapInuse, HeapSys: memory.HeapSys, TotalAlloc: memory.TotalAlloc,
		GCCycles: memory.NumGC, GCPauseNS: memory.PauseTotalNs, CgoCalls: runtime.NumCgoCall(),
		CPUTimeNS: processCPUTime(), SampledAtMS: time.Now().UnixMilli(),
	}
}
