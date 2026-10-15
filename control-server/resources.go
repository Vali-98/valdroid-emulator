package main

import (
	"encoding/json"
	"net/http"

	"emu_stream_test/internal/diagnostics"
)

func resourcesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_ = json.NewEncoder(w).Encode(diagnostics.Snapshot())
}
