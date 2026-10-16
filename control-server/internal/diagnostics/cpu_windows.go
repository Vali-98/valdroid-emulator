package diagnostics

import "syscall"

func processCPUTime() *uint64 {
	process, err := syscall.GetCurrentProcess()
	if err != nil {
		return nil
	}
	var created, exited, kernel, user syscall.Filetime
	if syscall.GetProcessTimes(process, &created, &exited, &kernel, &user) != nil {
		return nil
	}
	ns := ((uint64(kernel.HighDateTime)<<32 | uint64(kernel.LowDateTime)) + (uint64(user.HighDateTime)<<32 | uint64(user.LowDateTime))) * 100
	return &ns
}
