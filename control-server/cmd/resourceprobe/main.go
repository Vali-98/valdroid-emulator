// resourceprobe samples a server from outside the process, including native RSS.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"

	"control_server/internal/diagnostics"
	"github.com/shirou/gopsutil/v4/process"
)

type sample struct {
	at         time.Time
	cpuSeconds float64
	rss        uint64
}

type summary struct {
	Mean float64 `json:"mean"`
	P95  float64 `json:"p95"`
	Max  float64 `json:"max"`
}

type report struct {
	PID          int32                     `json:"pid"`
	Label        string                    `json:"label"`
	LogicalCPUs  int                       `json:"logicalCPUs"`
	Duration     float64                   `json:"durationSeconds"`
	Samples      int                       `json:"samples"`
	CPUPercent   summary                   `json:"cpuPercentOneCore"`
	RSSMiB       summary                   `json:"rssMiB"`
	RSSStartMiB  float64                   `json:"rssStartMiB"`
	RSSEndMiB    float64                   `json:"rssEndMiB"`
	RSSDeltaMiB  float64                   `json:"rssDeltaMiB"`
	RuntimeStart *diagnostics.RuntimeStats `json:"runtimeStart,omitempty"`
	RuntimeEnd   *diagnostics.RuntimeStats `json:"runtimeEnd,omitempty"`
}

func summarize(values []float64) summary {
	if len(values) == 0 {
		return summary{}
	}
	values = append([]float64(nil), values...)
	sort.Float64s(values)
	var sum float64
	for _, v := range values {
		sum += v
	}
	return summary{sum / float64(len(values)), values[(len(values)*95+99)/100-1], values[len(values)-1]}
}

func summarizeSamples(pid int32, label string, samples []sample) (report, error) {
	if len(samples) < 2 {
		return report{}, errors.New("at least two samples are required")
	}
	var cpu, rss []float64
	for i, s := range samples {
		rss = append(rss, float64(s.rss)/(1<<20))
		if i > 0 {
			elapsed := s.at.Sub(samples[i-1].at).Seconds()
			delta := s.cpuSeconds - samples[i-1].cpuSeconds
			if elapsed <= 0 || delta < 0 {
				return report{}, errors.New("nonmonotonic process samples")
			}
			cpu = append(cpu, delta/elapsed*100)
		}
	}
	first, last := samples[0], samples[len(samples)-1]
	duration := last.at.Sub(first.at).Seconds()
	cpuStats := summarize(cpu)
	cpuStats.Mean = (last.cpuSeconds - first.cpuSeconds) / duration * 100
	start, end := float64(first.rss)/(1<<20), float64(last.rss)/(1<<20)
	return report{PID: pid, Label: label, LogicalCPUs: runtime.NumCPU(), Duration: duration, Samples: len(samples), CPUPercent: cpuStats, RSSMiB: summarize(rss), RSSStartMiB: start, RSSEndMiB: end, RSSDeltaMiB: end - start}, nil
}

func readRuntime(base string) (*diagnostics.RuntimeStats, error) {
	parsed, err := url.Parse(base)
	if err != nil {
		return nil, err
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || (host != "localhost" && (ip == nil || !ip.IsLoopback())) {
		return nil, errors.New("server must be a local HTTP(S) URL; sampling remote PIDs is unsafe")
	}
	client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(strings.TrimRight(base, "/") + "/api/resources")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("resources HTTP status: %d", response.StatusCode)
	}
	var snapshot diagnostics.RuntimeStats
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&snapshot); err != nil {
		return nil, err
	}
	if snapshot.PID <= 0 {
		return nil, errors.New("invalid server PID")
	}
	return &snapshot, nil
}

func readSample(ctx context.Context, proc *process.Process) (sample, error) {
	cpu, err := proc.TimesWithContext(ctx)
	if err != nil {
		return sample{}, err
	}
	memory, err := proc.MemoryInfoWithContext(ctx)
	if err != nil {
		return sample{}, err
	}
	return sample{time.Now(), cpu.User + cpu.System, memory.RSS}, nil
}

func run() error {
	pid := flag.Int("pid", 0, "control-server process ID (or use --server)")
	server := flag.String("server", "", "local server base URL; discovers PID and includes Go heap/GC snapshots")
	duration := flag.Duration("duration", 30*time.Second, "measurement duration")
	interval := flag.Duration("interval", 250*time.Millisecond, "sampling interval")
	warmup := flag.Duration("warmup", 2*time.Second, "settling time before sampling")
	label := flag.String("label", "", "scenario label, e.g. idle or replay-60fps")
	flag.Parse()
	var runtimeStart *diagnostics.RuntimeStats
	if *server != "" {
		var err error
		runtimeStart, err = readRuntime(*server)
		if err != nil {
			return err
		}
		if *pid != 0 && *pid != runtimeStart.PID {
			return errors.New("server PID does not match --pid")
		}
		*pid = runtimeStart.PID
	}
	if *pid <= 0 || int64(*pid) > 1<<31-1 || *duration < *interval || *interval < 50*time.Millisecond || *warmup < 0 {
		return errors.New("invalid parameters: positive pid, duration >= interval >= 50ms, warmup >= 0 required")
	}
	proc, err := process.NewProcess(int32(*pid))
	if err != nil {
		return err
	}
	created, err := proc.CreateTime()
	if err != nil {
		return err
	}
	time.Sleep(*warmup)
	if *server != "" {
		runtimeStart, err = readRuntime(*server)
		if err != nil {
			return err
		}
		if runtimeStart.PID != *pid {
			return errors.New("server restarted during warmup")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), *duration+5*time.Second)
	defer cancel()
	first, err := readSample(ctx, proc)
	if err != nil {
		return err
	}
	samples := []sample{first}
	deadline := first.at.Add(*duration)
	ticker := time.NewTicker(*interval)
	defer ticker.Stop()
	for samples[len(samples)-1].at.Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			s, err := readSample(ctx, proc)
			if err != nil {
				return fmt.Errorf("process %d sampling failed: %w", *pid, err)
			}
			samples = append(samples, s)
		}
	}
	// Re-open to avoid cached creation times and reject PID reuse during a run.
	current, err := process.NewProcess(int32(*pid))
	if err != nil {
		return err
	}
	ended, err := current.CreateTime()
	if err != nil {
		return err
	}
	if ended != created {
		return errors.New("PID was reused during measurement")
	}
	result, err := summarizeSamples(int32(*pid), *label, samples)
	if err != nil {
		return err
	}
	if *server != "" {
		result.RuntimeStart = runtimeStart
		result.RuntimeEnd, err = readRuntime(*server)
		if err != nil {
			return err
		}
		if result.RuntimeEnd.PID != *pid {
			return errors.New("server restarted during measurement")
		}
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
