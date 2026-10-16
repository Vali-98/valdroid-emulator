package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
)

type displayState struct {
	ID          int32 `json:"id"`
	Width       int32 `json:"width"`
	Height      int32 `json:"height"`
	Orientation uint8 `json:"orientation"`
}

var displayStates = make(map[int32]displayState)
var displayStateMu sync.RWMutex

func requestedDisplay(r *http.Request) (int32, error) {
	if value := r.URL.Query().Get("display"); value != "" {
		id, err := strconv.ParseInt(value, 10, 32)
		if err != nil || id < 0 {
			return 0, errors.New("invalid display id")
		}
		return int32(id), nil
	}
	return primaryDisplayID, nil
}

func displayStateHandler(w http.ResponseWriter, r *http.Request) {
	id, err := requestedDisplay(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	displayStateMu.RLock()
	state, exists := displayStates[id]
	displayStateMu.RUnlock()
	if !exists {
		http.Error(w, "display metadata is not available yet", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(state)
}
