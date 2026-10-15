package diagnostics

import (
	"os"
	"runtime"
)

type RuntimeStats struct {
	PID        int    `json:"pid"`
	Goroutines int    `json:"goroutines"`
	HeapAlloc  uint64 `json:"heapAllocBytes"`
	HeapInuse  uint64 `json:"heapInuseBytes"`
	HeapSys    uint64 `json:"heapReservedBytes"`
	TotalAlloc uint64 `json:"totalAllocBytes"`
	GCCycles   uint32 `json:"gcCycles"`
	GCPauseNS  uint64 `json:"gcPauseTotalNs"`
	CgoCalls   int64  `json:"cgoCalls"`
}

func Snapshot() RuntimeStats {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	return RuntimeStats{os.Getpid(), runtime.NumGoroutine(), memory.HeapAlloc, memory.HeapInuse, memory.HeapSys, memory.TotalAlloc, memory.NumGC, memory.PauseTotalNs, runtime.NumCgoCall()}
}
