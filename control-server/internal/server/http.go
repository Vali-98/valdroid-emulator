package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"
)

var websocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(request *http.Request) bool {
		origin := request.Header.Get("Origin")
		if origin == "" {
			return true
		}
		if isWebviewOrigin(origin) {
			return true
		}
		return strings.EqualFold(origin, "http://"+request.Host) || strings.EqualFold(origin, "https://"+request.Host)
	},
}

func isWebviewOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	if parsed.Scheme == "vscode-webview" {
		return true
	}
	host := strings.ToLower(parsed.Hostname())
	return parsed.Scheme == "https" && parsed.Port() == "" && strings.HasSuffix(host, ".vscode-webview.net")
}

func allowWebviewRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		if origin := r.Header.Get("Origin"); isWebviewOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		next.ServeHTTP(w, r)
	})
}
