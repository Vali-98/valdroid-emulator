package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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
	api := deviceAPI{adbPath: "adb", serial: "emulator-5554", command: func(_ context.Context, file string, args ...string) ([]byte, error) {
		if file != "adb" || strings.Join(args, " ") != "-s emulator-5554 shell cmd media_session volume --stream 3 --get" {
			t.Errorf("unexpected command: %s %v", file, args)
		}
		return []byte("[V] volume is 0 in range [0..15]"), nil
	}}
	response := httptest.NewRecorder()
	api.volumeHandler(response, httptest.NewRequest(http.MethodGet, "/api/volume", nil))
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

func TestDeviceUploadHandler(t *testing.T) {
	var pushed bool
	api := deviceAPI{adbPath: "adb", serial: "emulator-5554", command: func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) >= 5 && args[2] == "push" {
			data, err := os.ReadFile(args[3])
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != "file contents" || args[4] != "/sdcard/Download/report.txt" {
				t.Fatalf("unexpected ADB push: %v, data=%q", args, data)
			}
			pushed = true
		}
		return nil, nil
	}}
	request := httptest.NewRequest(http.MethodPost, "/api/upload?name=report.txt", strings.NewReader("file contents"))
	request.RemoteAddr = "127.0.0.1:1234"
	response := httptest.NewRecorder()
	api.uploadHandler(response, request)
	if response.Code != http.StatusOK || !pushed {
		t.Fatalf("upload status = %d, pushed = %t: %s", response.Code, pushed, response.Body.String())
	}
	var result map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["path"] != "/sdcard/Download/report.txt" {
		t.Fatalf("unexpected path: %v", result)
	}
}

func TestDeviceUploadRejectsInvalidRequests(t *testing.T) {
	api := deviceAPI{serial: "emulator-5554"}
	for _, test := range []struct {
		name       string
		remoteAddr string
		origin     string
		status     int
	}{
		{"../escape.txt", "127.0.0.1:1234", "", http.StatusBadRequest},
		{"folder\\escape.txt", "127.0.0.1:1234", "", http.StatusBadRequest},
		{"safe.txt", "192.0.2.1:1234", "", http.StatusForbidden},
		{"safe.txt", "127.0.0.1:1234", "https://other.example", http.StatusForbidden},
	} {
		request := httptest.NewRequest(http.MethodPost, "/api/upload?name="+test.name, strings.NewReader("data"))
		request.RemoteAddr = test.remoteAddr
		request.Header.Set("Origin", test.origin)
		response := httptest.NewRecorder()
		api.uploadHandler(response, request)
		if response.Code != test.status {
			t.Errorf("%q: status = %d, want %d", test.name, response.Code, test.status)
		}
	}
	if _, err := uploadName("bad\x00name"); err == nil {
		t.Fatal("NUL filename was accepted")
	}
}
