package device

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"time"
)

var volumePattern = regexp.MustCompile(`volume is (\d+) in range \[(\d+)\.\.(\d+)\]`)

type API struct {
	adbPath string
	serial  string
	command func(context.Context, string, ...string) ([]byte, error)
}

func New(adbPath, serial string) API { return API{adbPath: adbPath, serial: serial} }

type deviceVolume struct {
	Current int `json:"current"`
	Min     int `json:"min"`
	Max     int `json:"max"`
}

func runDeviceCommand(ctx context.Context, executable string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, executable, args...).CombinedOutput()
}

func (api API) run(ctx context.Context, args ...string) ([]byte, error) {
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

func (api API) VolumeHandler(w http.ResponseWriter, r *http.Request) {
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
