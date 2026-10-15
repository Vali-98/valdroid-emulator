package server

import (
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"

	"control_server/internal/codec"
)

type durationWindow struct {
	values [600]float64
	count  uint64
}

func (w *durationWindow) add(duration time.Duration) {
	w.values[w.count%uint64(len(w.values))] = float64(duration) / float64(time.Millisecond)
	w.count++
}

type durationSummary struct {
	Samples int     `json:"samples"`
	MeanMS  float64 `json:"meanMs"`
	P50MS   float64 `json:"p50Ms"`
	P95MS   float64 `json:"p95Ms"`
	P99MS   float64 `json:"p99Ms"`
	MaxMS   float64 `json:"maxMs"`
}

func (w *durationWindow) summary() durationSummary {
	count := int(w.count)
	if count > len(w.values) {
		count = len(w.values)
	}
	if count == 0 {
		return durationSummary{}
	}
	values := append([]float64(nil), w.values[:count]...)
	sort.Float64s(values)
	var sum float64
	for _, value := range values {
		sum += value
	}
	quantile := func(q float64) float64 { return values[int(math.Ceil(q*float64(count)))-1] }
	return durationSummary{count, sum / float64(count), quantile(.5), quantile(.95), quantile(.99), values[count-1]}
}

type videoMetrics struct {
	mu                    sync.Mutex
	started               time.Time
	lastInput, lastEncode time.Time
	lastPTS               int64
	input, decoded        uint64
	encoded, delivered    uint64
	encodeDrops           uint64
	clientDrops           uint64
	decodeErrors          uint64
	encodeErrors          uint64
	decode, encode, queue durationWindow
	sourceIntervals       durationWindow
	arrivalIntervals      durationWindow
	encodeIntervals       durationWindow
	residence, writes     durationWindow
}

var metricsRegistry = struct {
	sync.Mutex
	displays map[int32]*videoMetrics
}{displays: make(map[int32]*videoMetrics)}

func metricsFor(display int32) *videoMetrics {
	metricsRegistry.Lock()
	defer metricsRegistry.Unlock()
	metrics := metricsRegistry.displays[display]
	if metrics == nil {
		metrics = &videoMetrics{}
		metricsRegistry.displays[display] = metrics
	}
	return metrics
}
func (m *videoMetrics) receive(now time.Time, pts int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.started.IsZero() {
		m.started = now
	}
	if !m.lastInput.IsZero() {
		m.arrivalIntervals.add(now.Sub(m.lastInput))
	}
	if m.lastPTS > 0 && pts > m.lastPTS {
		m.sourceIntervals.add(time.Duration(pts-m.lastPTS) * time.Microsecond)
	}
	m.lastInput, m.lastPTS = now, pts
	m.input++
}

type performanceSnapshot struct {
	DisplayID        int32           `json:"displayId"`
	Encoder          string          `json:"encoder"`
	Quality          int             `json:"jpegQuality"`
	ElapsedSeconds   float64         `json:"elapsedSeconds"`
	InputFrames      uint64          `json:"inputFrames"`
	DecodedFrames    uint64          `json:"decodedFrames"`
	EncodedFrames    uint64          `json:"encodedFrames"`
	DeliveredFrames  uint64          `json:"deliveredFrames"`
	EncodeDrops      uint64          `json:"encodeDrops"`
	ClientDrops      uint64          `json:"clientDrops"`
	DecodeErrors     uint64          `json:"decodeErrors"`
	EncodeErrors     uint64          `json:"encodeErrors"`
	Decode           durationSummary `json:"decode"`
	JPEGEncode       durationSummary `json:"jpegEncode"`
	EncodeQueue      durationSummary `json:"encodeQueue"`
	SourceIntervals  durationSummary `json:"sourceIntervals"`
	ArrivalIntervals durationSummary `json:"arrivalIntervals"`
	EncodeIntervals  durationSummary `json:"encodeIntervals"`
	ServerResidence  durationSummary `json:"serverResidence"`
	HTTPWrite        durationSummary `json:"httpWrite"`
}

func (m *videoMetrics) snapshot(display int32) performanceSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	var elapsed float64
	if !m.started.IsZero() {
		elapsed = time.Since(m.started).Seconds()
	}
	return performanceSnapshot{DisplayID: display, Encoder: codec.JPEGEncoderName, Quality: jpegQuality, ElapsedSeconds: elapsed,
		InputFrames: m.input, DecodedFrames: m.decoded, EncodedFrames: m.encoded, DeliveredFrames: m.delivered,
		EncodeDrops: m.encodeDrops, ClientDrops: m.clientDrops, DecodeErrors: m.decodeErrors, EncodeErrors: m.encodeErrors,
		Decode: m.decode.summary(), JPEGEncode: m.encode.summary(), EncodeQueue: m.queue.summary(),
		SourceIntervals: m.sourceIntervals.summary(), ArrivalIntervals: m.arrivalIntervals.summary(), EncodeIntervals: m.encodeIntervals.summary(),
		ServerResidence: m.residence.summary(), HTTPWrite: m.writes.summary()}
}
func performanceHandler(w http.ResponseWriter, r *http.Request) {
	display, err := requestedDisplay(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(metricsFor(display).snapshot(display))
}
