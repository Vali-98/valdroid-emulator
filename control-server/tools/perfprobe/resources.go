package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

type sample struct {
	at         time.Time
	cpuSeconds float64
	rss        uint64
}

type resourceSummary struct {
	Mean float64 `json:"mean"`
	P95  float64 `json:"p95"`
	Max  float64 `json:"max"`
}

type report struct {
	PID         int32           `json:"pid"`
	Label       string          `json:"label"`
	LogicalCPUs int             `json:"logicalCPUs"`
	Duration    float64         `json:"durationSeconds"`
	Samples     int             `json:"samples"`
	CPUPercent  resourceSummary `json:"cpuPercentOneCore"`
	RSSMiB      resourceSummary `json:"rssMiB"`
	RSSStartMiB float64         `json:"rssStartMiB"`
	RSSEndMiB   float64         `json:"rssEndMiB"`
	RSSDeltaMiB float64         `json:"rssDeltaMiB"`
}

func summarizeResources(values []float64) resourceSummary {
	stats := summarize(values)
	return resourceSummary{stats.Mean, stats.P95, stats.Max}
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
	cpuStats := summarizeResources(cpu)
	cpuStats.Mean = (last.cpuSeconds - first.cpuSeconds) / duration * 100
	start, end := float64(first.rss)/(1<<20), float64(last.rss)/(1<<20)
	return report{PID: pid, Label: label, LogicalCPUs: runtime.NumCPU(), Duration: duration, Samples: len(samples), CPUPercent: cpuStats, RSSMiB: summarizeResources(rss), RSSStartMiB: start, RSSEndMiB: end, RSSDeltaMiB: end - start}, nil
}

func discoverPID(base string) (int32, error) {
	parsed, err := url.Parse(base)
	if err != nil {
		return 0, err
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || (host != "localhost" && (ip == nil || !ip.IsLoopback())) {
		return 0, errors.New("server must be a local HTTP(S) URL; sampling remote PIDs is unsafe")
	}
	client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(strings.TrimRight(base, "/") + "/api/resources")
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("resources HTTP status: %d", response.StatusCode)
	}
	var snapshot struct {
		PID int32 `json:"pid"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&snapshot); err != nil {
		return 0, err
	}
	if snapshot.PID <= 0 {
		return 0, errors.New("invalid server PID")
	}
	return snapshot.PID, nil
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
