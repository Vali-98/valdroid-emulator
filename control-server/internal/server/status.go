package server

import (
	"encoding/json"
	"net/http"
)

type serverStatus struct {
	VideoConnected   bool   `json:"videoConnected"`
	AudioConnected   bool   `json:"audioConnected"`
	AudioConfigured  bool   `json:"audioConfigured"`
	AudioPackets     uint64 `json:"audioPackets"`
	ControlConnected bool   `json:"controlConnected"`
	VideoPackets     uint64 `json:"videoPackets"`
	LastVideoPTS     int64  `json:"lastVideoPTSUs"`
	AgentStarting    bool   `json:"agentStarting"`
	AgentStarted     bool   `json:"agentStarted"`
	AgentError       string `json:"agentError,omitempty"`
}

func serverStatusHandler(w http.ResponseWriter, r *http.Request) {
	channelStatusMu.RLock()
	status := serverStatus{
		VideoConnected: videoChannels > 0,
		AudioConnected: audioChannels > 0,
		VideoPackets:   videoPacketCount.Load(),
		AudioPackets:   audioPacketCount.Load(),
		LastVideoPTS:   lastVideoPTS.Load(),
	}
	channelStatusMu.RUnlock()
	agentControlMu.Lock()
	status.ControlConnected = agentControl != nil
	agentControlMu.Unlock()
	agentStateMu.RLock()
	status.AgentStarting = agentStarting
	status.AgentStarted = agentStarted
	status.AgentError = agentStartError
	agentStateMu.RUnlock()
	audioMu.Lock()
	status.AudioConfigured = len(audioConfig) != 0
	audioMu.Unlock()
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(status)
}
