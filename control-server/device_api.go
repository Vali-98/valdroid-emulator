package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const maxUploadSize int64 = 4 << 30

var volumePattern = regexp.MustCompile(`volume is (\d+) in range \[(\d+)\.\.(\d+)\]`)

type deviceAPI struct {
	adbPath string
	serial  string
	command func(context.Context, string, ...string) ([]byte, error)
}

type deviceVolume struct {
	Current int `json:"current"`
	Min     int `json:"min"`
	Max     int `json:"max"`
}

func runDeviceCommand(ctx context.Context, executable string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, executable, args...).CombinedOutput()
}

func (api deviceAPI) run(ctx context.Context, args ...string) ([]byte, error) {
	command := api.command
	if command == nil {
		command = runDeviceCommand
	}
	return command(ctx, api.adbPath, append([]string{"-s", api.serial}, args...)...)
}

func parseDeviceVolume(output []byte) (deviceVolume, error) {
	match := volumePattern.FindSubmatch(output)
	if match == nil {
		return deviceVolume{}, fmt.Errorf("media volume not found in ADB output")
	}
	current, _ := strconv.Atoi(string(match[1]))
	minimum, _ := strconv.Atoi(string(match[2]))
	maximum, _ := strconv.Atoi(string(match[3]))
	if minimum > maximum || current < minimum || current > maximum {
		return deviceVolume{}, fmt.Errorf("invalid media volume range")
	}
	return deviceVolume{Current: current, Min: minimum, Max: maximum}, nil
}

func (api deviceAPI) volumeHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != http.MethodGet {
		http.Error(w, "GET required", http.StatusMethodNotAllowed)
		return
	}
	if api.serial == "" {
		http.Error(w, "no Android device selected", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	output, err := api.run(ctx, "shell", "cmd", "media_session", "volume", "--stream", "3", "--get")
	if err != nil {
		http.Error(w, fmt.Sprintf("could not read media volume: %v", err), http.StatusBadGateway)
		return
	}
	volume, err := parseDeviceVolume(output)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(volume)
}

func loopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	return err == nil && net.ParseIP(host).IsLoopback()
}

func uploadOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || strings.HasPrefix(origin, "vscode-webview://") {
		return true
	}
	return strings.EqualFold(origin, "http://"+r.Host) || strings.EqualFold(origin, "https://"+r.Host)
}

func uploadName(raw string) (string, error) {
	if raw == "" || raw == "." || raw == ".." || strings.ContainsAny(raw, "/\\\x00\r\n") || path.Base(raw) != raw {
		return "", errors.New("invalid filename")
	}
	return raw, nil
}

func (api deviceAPI) uploadHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if !loopbackRequest(r) || !uploadOriginAllowed(r) {
		http.Error(w, "upload origin not allowed", http.StatusForbidden)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if api.serial == "" {
		http.Error(w, "no Android device selected", http.StatusServiceUnavailable)
		return
	}
	name, err := uploadName(r.URL.Query().Get("name"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if r.ContentLength > maxUploadSize {
		http.Error(w, "file exceeds 4 GiB upload limit", http.StatusRequestEntityTooLarge)
		return
	}
	temporary, err := os.CreateTemp("", "valdroid-upload-*")
	if err != nil {
		http.Error(w, "could not prepare upload", http.StatusInternalServerError)
		return
	}
	defer os.Remove(temporary.Name())
	written, copyErr := io.Copy(temporary, io.LimitReader(r.Body, maxUploadSize+1))
	closeErr := temporary.Close()
	if written > maxUploadSize {
		http.Error(w, "file exceeds 4 GiB upload limit", http.StatusRequestEntityTooLarge)
		return
	}
	if copyErr != nil || closeErr != nil {
		http.Error(w, "could not receive file", http.StatusBadRequest)
		return
	}
	destination := "/sdcard/Download/" + name
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	output, err := api.run(ctx, "push", temporary.Name(), destination)
	if err != nil {
		log.Printf("ADB push failed: %v: %s", err, strings.TrimSpace(string(output)))
		http.Error(w, "could not send file to device", http.StatusBadGateway)
		return
	}
	uri := (&url.URL{Scheme: "file", Path: destination}).String()
	if output, err := api.run(ctx, "shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", uri); err != nil {
		log.Printf("Media scan for %s failed: %v: %s", name, err, strings.TrimSpace(string(output)))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"path": destination})
}
