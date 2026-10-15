package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"runtime"
	"syscall"
)

func portUnavailable(err error) bool {
	// Winsock uses separate codes for occupied and excluded/exclusively bound ports.
	return errors.Is(err, syscall.EADDRINUSE) || (runtime.GOOS == "windows" &&
		(errors.Is(err, syscall.Errno(10048)) || errors.Is(err, syscall.Errno(10013))))
}

func listenAddress(address string, autoPort bool) (net.Listener, error) {
	listener, err := net.Listen("tcp", address)
	if err == nil || !autoPort || !portUnavailable(err) {
		return listener, err
	}
	host, _, splitErr := net.SplitHostPort(address)
	if splitErr != nil {
		return nil, err
	}
	listener, err = net.Listen("tcp", net.JoinHostPort(host, "0"))
	if err == nil {
		log.Printf("Port unavailable at %s; using %s", address, listener.Addr())
	}
	return listener, err
}

func listenEndpoints(httpAddress, socketAddress string, autoPort bool) (net.Listener, net.Listener, error) {
	socketListener, err := listenAddress(socketAddress, autoPort)
	if err != nil {
		return nil, nil, fmt.Errorf("agent listener: %w", err)
	}
	httpListener, err := listenAddress(httpAddress, autoPort)
	if err != nil {
		_ = socketListener.Close()
		return nil, nil, fmt.Errorf("HTTP listener: %w", err)
	}
	return httpListener, socketListener, nil
}

func announceListeners(output io.Writer, httpListener, socketListener net.Listener) error {
	return json.NewEncoder(output).Encode(struct {
		Type          string `json:"type"`
		HTTPURL       string `json:"httpUrl"`
		SocketAddress string `json:"socketAddress"`
	}{"server-listening", "http://" + browserHost(httpListener.Addr().String()), socketListener.Addr().String()})
}
