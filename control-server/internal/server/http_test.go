package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestWebviewConnections(t *testing.T) {
	for _, origin := range []string{"vscode-webview://test-view", "https://test-view.vscode-webview.net"} {
		t.Run(origin, func(t *testing.T) {
			server := httptest.NewServer(allowWebviewRequests(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/avc" {
					conn, err := websocketUpgrader.Upgrade(w, r, nil)
					if err == nil {
						_ = conn.Close()
					}
					return
				}
				w.WriteHeader(http.StatusOK)
			})))
			defer server.Close()
			headers := http.Header{"Origin": {origin}}
			conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/avc", headers)
			if err != nil {
				t.Fatal(err)
			}
			_ = conn.Close()
			request, _ := http.NewRequest("GET", server.URL+"/api/display-state", nil)
			request.Header = headers
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if got := response.Header.Get("Access-Control-Allow-Origin"); got != origin {
				t.Fatalf("CORS origin = %q", got)
			}
		})
	}
}

func TestRejectUntrustedWebviewOrigins(t *testing.T) {
	for _, origin := range []string{"https://example.com", "null", "https://vscode-webview.net.evil.com", "https://view.vscode-webview.net.evil.com", "http://view.vscode-webview.net", "https://view.vscode-webview.net:8443", "https://user@view.vscode-webview.net", "https://view.vscode-webview.net/path"} {
		request := httptest.NewRequest("GET", "http://127.0.0.1/avc", nil)
		request.Header.Set("Origin", origin)
		if websocketUpgrader.CheckOrigin(request) {
			t.Errorf("accepted untrusted origin %q", origin)
		}
	}
}
