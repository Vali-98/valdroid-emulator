// perfprobe is an external load generator and process sampler; it is not linked into the server.
package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v4/process"
)

type summary struct {
	Samples int     `json:"samples"`
	Mean    float64 `json:"meanMs"`
	P50     float64 `json:"p50Ms"`
	P95     float64 `json:"p95Ms"`
	P99     float64 `json:"p99Ms"`
	Max     float64 `json:"maxMs"`
}

func summarize(values []float64) summary {
	if len(values) == 0 {
		return summary{}
	}
	values = append([]float64(nil), values...)
	sort.Float64s(values)
	var sum float64
	for _, value := range values {
		sum += value
	}
	quantile := func(percent int) float64 { return values[(len(values)*percent+99)/100-1] }
	return summary{len(values), sum / float64(len(values)), quantile(50), quantile(95), quantile(99), values[len(values)-1]}
}

type frame struct {
	pts        int64
	number     uint32
	processing float64
	jpeg       []byte
	bytes      int64
	received   time.Time
}

type sentFrame struct {
	number uint32
	at     time.Time
}
type replayClock struct {
	sync.Mutex
	frames [2048]sentFrame
}

func (clock *replayClock) sent(number uint32) {
	clock.Lock()
	clock.frames[number%2048] = sentFrame{number, time.Now()}
	clock.Unlock()
}
func (clock *replayClock) age(number uint32, now time.Time) (float64, bool) {
	clock.Lock()
	sent := clock.frames[number%2048]
	clock.Unlock()
	return float64(now.Sub(sent.at)) / float64(time.Millisecond), sent.number == number && !sent.at.IsZero()
}

type frameReport struct {
	Frames           int     `json:"frames"`
	FPS              float64 `json:"fps"`
	JPEGBytes        int64   `json:"jpegBytes"`
	NonmonotonicPTS  int     `json:"nonmonotonicPTS"`
	ReceiveIntervals summary `json:"receiveIntervals"`
	SourceIntervals  summary `json:"sourceIntervals"`
	ServerProcessing summary `json:"serverProcessing"`
	ReplayToReceive  summary `json:"replayToReceive"`
}

func openFrames(ctx context.Context, base, transport string, keepJPEG bool) (func() (frame, error), func(), error) {
	if transport == "websocket" {
		address := "ws" + strings.TrimPrefix(strings.TrimRight(base, "/"), "http") + "/video"
		connection, _, err := websocket.DefaultDialer.DialContext(ctx, address, nil)
		if err != nil {
			return nil, nil, err
		}
		connection.SetReadLimit(64 << 20)
		stop := closeOnCancel(ctx, connection)
		return func() (frame, error) {
			kind, data, err := connection.ReadMessage()
			if err != nil {
				return frame{}, err
			}
			if kind != websocket.BinaryMessage || len(data) < 42 || string(data[:4]) != "VDJP" {
				return frame{}, errors.New("invalid video envelope")
			}
			result := frame{number: binary.LittleEndian.Uint32(data[20:24]), pts: int64(binary.LittleEndian.Uint64(data[24:32])), processing: float64(binary.LittleEndian.Uint64(data[32:40])) / 1000, received: time.Now(), bytes: int64(len(data) - 40)}
			if keepJPEG {
				result.jpeg = data[40:]
			}
			return result, nil
		}, func() { stop(); _ = connection.Close() }, nil
	}
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/stream", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, nil, err
	}
	_, parameters, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || response.StatusCode != http.StatusOK || parameters["boundary"] == "" {
		response.Body.Close()
		return nil, nil, errors.New("invalid MJPEG response")
	}
	reader := multipart.NewReader(response.Body, parameters["boundary"])
	return func() (frame, error) {
		part, err := reader.NextPart()
		if err != nil {
			return frame{}, err
		}
		size, err := strconv.ParseInt(part.Header.Get("Content-Length"), 10, 64)
		if err != nil || size < 1 || size > 64<<20 {
			return frame{}, errors.New("invalid JPEG size")
		}
		pts, _ := strconv.ParseInt(part.Header.Get("X-Presentation-Timestamp-Us"), 10, 64)
		number, _ := strconv.ParseUint(part.Header.Get("X-Frame-Number"), 10, 32)
		processing, _ := strconv.ParseFloat(part.Header.Get("X-Server-Processing-Us"), 64)
		result := frame{pts: pts, number: uint32(number), processing: processing / 1000, bytes: size}
		if keepJPEG {
			result.jpeg = make([]byte, size)
			_, err = io.ReadFull(part, result.jpeg)
		} else {
			_, err = io.CopyN(io.Discard, part, size)
		}
		if err != nil {
			return frame{}, err
		}
		result.received = time.Now()
		return result, nil
	}, func() { _ = response.Body.Close() }, nil
}

func sampleResources(ctx context.Context, pid int32, start, end time.Time, interval time.Duration) (report, error) {
	proc, err := process.NewProcess(pid)
	if err != nil {
		return report{}, err
	}
	created, err := proc.CreateTime()
	if err != nil {
		return report{}, err
	}
	timer := time.NewTimer(time.Until(start))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return report{}, ctx.Err()
	case <-timer.C:
	}
	first, err := readSample(ctx, proc)
	if err != nil {
		return report{}, err
	}
	samples := []sample{first}
	for time.Now().Before(end) {
		next := time.Now().Add(interval)
		if next.After(end) {
			next = end
		}
		timer.Reset(time.Until(next))
		select {
		case <-ctx.Done():
			return report{}, ctx.Err()
		case <-timer.C:
		}
		value, err := readSample(ctx, proc)
		if err != nil {
			return report{}, err
		}
		samples = append(samples, value)
	}
	current, err := process.NewProcess(pid)
	if err != nil {
		return report{}, err
	}
	ended, err := current.CreateTime()
	if err != nil || ended != created {
		return report{}, errors.New("server exited or its PID was reused")
	}
	return summarizeSamples(pid, "combined", samples)
}

func run(parent context.Context, args []string, output io.Writer) error {
	flags := flag.NewFlagSet("perfprobe", flag.ContinueOnError)
	base := flags.String("url", "http://127.0.0.1:38475", "local server URL")
	pid := flags.Int("pid", 0, "server PID; otherwise discover through /api/resources")
	duration := flags.Duration("duration", 30*time.Second, "shared measurement window")
	warmup := flags.Duration("warmup", 3*time.Second, "warmup before sampling")
	interval := flags.Duration("interval", 250*time.Millisecond, "external CPU/RSS sample interval")
	replayFile := flags.String("replay", "", "Annex-B AVC fixture (never replay into a live agent)")
	agent := flags.String("agent", "127.0.0.1:38476", "agent listener for replay")
	width := flags.Int("width", 1080, "replay width")
	height := flags.Int("height", 2400, "replay height")
	fps := flags.Int("fps", 60, "target cadence")
	transport := flags.String("transport", "websocket", "websocket or mjpeg")
	interact := flags.Bool("exercise-input", false, "swipe the foreground app (dedicated device only)")
	touch := flags.Bool("touch-latency", false, "tap and detect the frame-clock fixture's visual response")
	assertTarget := flags.Bool("assert-target", false, "assert sustained frame consistency")
	describe := flags.Bool("describe", false, "print parsed timing options without starting a test")
	startAt := flags.Int64("start-at", 0, "optional shared measurement start, Unix milliseconds")
	if err := flags.Parse(args); err != nil {
		return err
	}
	parsed, err := url.Parse(*base)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("invalid server URL")
	}
	if *duration <= 0 || *warmup < 0 || *interval < 50*time.Millisecond || *duration < *interval || *fps <= 0 || *fps > 240 || *width < 1 || *height < 1 || (*transport != "websocket" && *transport != "mjpeg") {
		return errors.New("invalid measurement parameters")
	}
	if *touch && (*replayFile != "" || *interact) {
		return errors.New("touch-latency requires only the live frame-clock fixture")
	}
	if *describe {
		return json.NewEncoder(output).Encode(map[string]int64{"durationMs": duration.Milliseconds(), "warmupMs": warmup.Milliseconds()})
	}
	if *pid == 0 {
		snapshot, err := readRuntime(*base)
		if err != nil {
			return err
		}
		*pid = snapshot.PID
	}
	if *pid <= 0 || int64(*pid) > 1<<31-1 {
		return errors.New("invalid server PID")
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	start := time.Now().Add(*warmup)
	if *startAt != 0 {
		start = time.UnixMilli(*startAt)
	}
	end := start.Add(*duration)
	streamContext, stopStream := context.WithDeadline(ctx, end)
	defer stopStream()
	var background sync.WaitGroup
	backgroundErrors := make(chan error, 3)
	launch := func(work func() error) {
		background.Add(1)
		go func() {
			defer background.Done()
			if err := work(); err != nil && streamContext.Err() == nil {
				backgroundErrors <- err
				cancel()
			}
		}()
	}
	var clock replayClock
	if *replayFile != "" {
		data, err := os.ReadFile(*replayFile)
		if err != nil {
			return err
		}
		units, err := accessUnits(data)
		if err != nil {
			return err
		}
		launch(func() error { return replay(streamContext, *agent, units, *width, *height, *fps, &clock) })
	}
	if *interact {
		launch(func() error { return exerciseInput(streamContext, *base) })
	}
	defer func() { cancel(); background.Wait() }()
	resources := make(chan struct {
		report report
		err    error
	}, 1)
	go func() {
		result, err := sampleResources(ctx, int32(*pid), start, end, *interval)
		resources <- struct {
			report report
			err    error
		}{result, err}
		if err != nil {
			cancel()
		}
	}()
	next, closeStream, err := openFrames(streamContext, *base, *transport, *touch)
	if err != nil {
		cancel()
		<-resources
		return err
	}
	defer closeStream()
	var touchTest *touchProbe
	if *touch {
		touchTest = newTouchProbe(start)
		launch(func() error { return touchTest.run(streamContext, *base) })
		defer touchTest.close()
	}
	var result frameReport
	var previous frame
	var gaps, sourceGaps, processing, ages []float64
	for {
		current, err := next()
		if err != nil {
			if streamContext.Err() != nil {
				break
			}
			cancel()
			<-resources
			return err
		}
		if touchTest != nil {
			touchTest.observe(current)
		}
		if current.received.Before(start) || !current.received.Before(end) {
			continue
		}
		result.Frames++
		result.JPEGBytes += current.bytes
		if !previous.received.IsZero() {
			gaps = append(gaps, float64(current.received.Sub(previous.received))/float64(time.Millisecond))
			if current.pts <= previous.pts {
				result.NonmonotonicPTS++
			} else {
				sourceGaps = append(sourceGaps, float64(current.pts-previous.pts)/1000)
			}
		}
		if current.processing > 0 {
			processing = append(processing, current.processing)
		}
		if *replayFile != "" {
			if age, ok := clock.age(current.number, current.received); ok {
				ages = append(ages, age)
			}
		}
		previous = current
	}
	resourceResult := <-resources
	if resourceResult.err != nil {
		select {
		case err := <-backgroundErrors:
			return err
		default:
		}
		return resourceResult.err
	}
	stopStream()
	background.Wait()
	select {
	case err := <-backgroundErrors:
		return err
	default:
	}
	result.FPS = float64(result.Frames) / duration.Seconds()
	result.ReceiveIntervals, result.SourceIntervals, result.ServerProcessing, result.ReplayToReceive = summarize(gaps), summarize(sourceGaps), summarize(processing), summarize(ages)
	combined := struct {
		Transport string      `json:"transport"`
		Duration  float64     `json:"durationSeconds"`
		Video     frameReport `json:"video"`
		Resources report      `json:"resources"`
		Touch     any         `json:"touch,omitempty"`
	}{Transport: *transport, Duration: duration.Seconds(), Video: result, Resources: resourceResult.report}
	if touchTest != nil {
		combined.Touch = touchTest.snapshot()
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(combined); err != nil {
		return err
	}
	if *assertTarget && (result.FPS < float64(*fps)*.98 || result.NonmonotonicPTS > 0 || result.ReceiveIntervals.P95 > 1500/float64(*fps)) {
		return errors.New("frame consistency target failed")
	}
	return nil
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
