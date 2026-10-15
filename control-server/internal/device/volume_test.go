package device

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseDeviceVolume(t *testing.T) {
	volume, err := parseDeviceVolume([]byte("[V] will get volume\n[V] volume is 7 in range [0..15]\n"))
	if err != nil || volume.Current != 7 || volume.Min != 0 || volume.Max != 15 {
		t.Fatalf("volume = %+v, err = %v", volume, err)
	}
	if _, err := parseDeviceVolume([]byte("volume is 20 in range [0..15]")); err == nil {
		t.Fatal("out-of-range volume was accepted")
	}
}

func TestDeviceVolumeHandler(t *testing.T) {
	api := API{adbPath: "adb", serial: "emulator-5554", command: func(_ context.Context, file string, args ...string) ([]byte, error) {
		if file != "adb" || strings.Join(args, " ") != "-s emulator-5554 shell cmd media_session volume --stream 3 --get" {
			t.Errorf("unexpected command: %s %v", file, args)
		}
		return []byte("[V] volume is 0 in range [0..15]"), nil
	}}
	response := httptest.NewRecorder()
	api.VolumeHandler(response, httptest.NewRequest(http.MethodGet, "/api/volume", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	var volume deviceVolume
	if err := json.Unmarshal(response.Body.Bytes(), &volume); err != nil {
		t.Fatal(err)
	}
	if volume.Current != 0 || volume.Max != 15 {
		t.Fatalf("unexpected volume: %+v", volume)
	}
}
