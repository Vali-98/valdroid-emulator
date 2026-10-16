//go:build darwin || linux

package diagnostics

import "syscall"

func processCPUTime() *uint64 {
	var usage syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &usage) != nil {
		return nil
	}
	ns := uint64(usage.Utime.Sec+usage.Stime.Sec)*1e9 + uint64(usage.Utime.Usec+usage.Stime.Usec)*1000
	return &ns
}
