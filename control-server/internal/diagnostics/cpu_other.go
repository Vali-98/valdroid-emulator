//go:build !darwin && !linux && !windows

package diagnostics

func processCPUTime() *uint64 { return nil }
