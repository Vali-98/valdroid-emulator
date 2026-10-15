package server

import "sync"

var (
	agentStateMu    sync.RWMutex
	agentStarting   bool
	agentStarted    bool
	agentStartError string
)

func setAgentState(starting, started bool, err string) {
	agentStateMu.Lock()
	agentStarting, agentStarted, agentStartError = starting, started, err
	agentStateMu.Unlock()
}
