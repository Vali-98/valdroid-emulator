package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net"
	"runtime"
	"syscall"
	"testing"
)

func reservePort(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

func TestListenAddressFallsBackOnlyWhenEnabled(t *testing.T) {
	occupied := reservePort(t)
	address := occupied.Addr().String()
	if listener, err := listenAddress(address, false); err == nil {
		_ = listener.Close()
		t.Fatal("explicit occupied port should fail without --auto-port")
	}
	listener, err := listenAddress(address, true)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if listener.Addr().String() == address || !listener.Addr().(*net.TCPAddr).IP.IsLoopback() {
		t.Fatalf("unexpected fallback address: %s", listener.Addr())
	}
	if other, err := net.Listen("tcp", address); err == nil {
		_ = other.Close()
		t.Fatal("fallback must leave the original listener alone")
	}
}

func TestListenAddressKeepsAvailablePreferredPort(t *testing.T) {
	reservation := reservePort(t)
	address := reservation.Addr().String()
	_ = reservation.Close()
	listener, err := listenAddress(address, true)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if listener.Addr().String() != address {
		t.Fatalf("address = %s, want %s", listener.Addr(), address)
	}
}

func TestBothOccupiedEndpointsGetDistinctFallbackPorts(t *testing.T) {
	occupiedHTTP, occupiedAgent := reservePort(t), reservePort(t)
	httpListener, socketListener, err := listenEndpoints(occupiedHTTP.Addr().String(), occupiedAgent.Addr().String(), true)
	if err != nil {
		t.Fatal(err)
	}
	defer httpListener.Close()
	defer socketListener.Close()
	addresses := map[string]bool{}
	for _, listener := range []net.Listener{occupiedHTTP, occupiedAgent, httpListener, socketListener} {
		address := listener.Addr().String()
		if addresses[address] {
			t.Fatalf("listeners share %s", address)
		}
		addresses[address] = true
	}
}

func TestListenerAnnouncementReportsActualEphemeralAddresses(t *testing.T) {
	httpListener, socketListener, err := listenEndpoints("127.0.0.1:0", "127.0.0.1:0", false)
	if err != nil {
		t.Fatal(err)
	}
	defer httpListener.Close()
	defer socketListener.Close()
	var output bytes.Buffer
	if err := announceListeners(&output, httpListener, socketListener); err != nil {
		t.Fatal(err)
	}
	var event map[string]string
	if err := json.Unmarshal(output.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if event["type"] != "server-listening" || event["httpUrl"] != "http://"+httpListener.Addr().String() || event["socketAddress"] != socketListener.Addr().String() {
		t.Fatalf("incorrect announcement: %v", event)
	}
	if output.Bytes()[output.Len()-1] != '\n' {
		t.Fatal("announcement must be a complete stdout line")
	}
}

func TestHTTPListenerFailureClosesAgentListener(t *testing.T) {
	reservation := reservePort(t)
	address := reservation.Addr().String()
	_ = reservation.Close()
	if _, _, err := listenEndpoints("127.0.0.1:invalid", address, true); err == nil {
		t.Fatal("invalid HTTP address must fail")
	}
	reopened, err := net.Listen("tcp", address)
	if err != nil {
		t.Fatalf("agent port was leaked: %v", err)
	}
	_ = reopened.Close()
}

func TestPortUnavailableDoesNotHideOtherErrors(t *testing.T) {
	if !portUnavailable(&net.OpError{Err: syscall.EADDRINUSE}) {
		t.Fatal("wrapped occupied-port error must be recognized")
	}
	for _, err := range []error{syscall.EACCES, errors.New("invalid address"), io.EOF} {
		if portUnavailable(err) {
			t.Fatalf("unexpected fallback for %v", err)
		}
	}
	for _, code := range []syscall.Errno{10048, 10013} {
		if portUnavailable(code) != (runtime.GOOS == "windows") {
			t.Fatalf("incorrect Winsock handling for %v", code)
		}
	}
}
