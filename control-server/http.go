package main

import (
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

var websocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(request *http.Request) bool {
		origin := request.Header.Get("Origin")
		if origin == "" {
			return true
		}
		if strings.HasPrefix(origin, "vscode-webview://") {
			return true
		}
		return strings.EqualFold(origin, "http://"+request.Host) || strings.EqualFold(origin, "https://"+request.Host)
	},
}
