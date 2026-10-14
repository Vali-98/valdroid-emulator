package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"sync"
	"time"
)

type motionPointer struct {
	X        int32        `json:"x"`
	Y        int32        `json:"y"`
	ID       int32        `json:"id"`
	AxisData []motionAxis `json:"axes"`
}

type motionAxis struct {
	Axis  int32   `json:"axis"`
	Value float32 `json:"value"`
}

type inputCommand struct {
	Type         string          `json:"type"`
	Pointers     []motionPointer `json:"pointers"`
	Action       int32           `json:"action"`
	ButtonState  int32           `json:"buttonState"`
	ActionButton int32           `json:"actionButton"`
	DisplayID    int32           `json:"displayId"`
	IsMouse      bool            `json:"isMouse"`
	KeyCode      int32           `json:"keyCode"`
	MetaState    uint32          `json:"metaState"`
}

var (
	agentControl   net.Conn
	agentControlMu sync.Mutex
)

func appendLEB128(buffer []byte, value uint32) []byte {
	for value >= 0x80 {
		buffer = append(buffer, byte(value)|0x80)
		value >>= 7
	}
	return append(buffer, byte(value))
}

func appendControlInt(buffer []byte, value int32) []byte {
	return appendLEB128(buffer, uint32(value))
}

func encodeInputCommand(command inputCommand) ([]byte, error) {
	var message []byte
	switch command.Type {
	case "motion":
		if len(command.Pointers) > 2 {
			return nil, errors.New("agent accepts at most two pointers")
		}
		message = appendControlInt(message, 1)
		message = appendLEB128(message, uint32(len(command.Pointers)))
		for _, pointer := range command.Pointers {
			message = appendControlInt(message, pointer.X)
			message = appendControlInt(message, pointer.Y)
			message = appendControlInt(message, pointer.ID)
			message = appendLEB128(message, uint32(len(pointer.AxisData)))
			for _, axis := range pointer.AxisData {
				message = appendControlInt(message, axis.Axis)
				var value [4]byte
				binary.LittleEndian.PutUint32(value[:], math.Float32bits(axis.Value))
				message = append(message, value[:]...)
			}
		}
		message = appendControlInt(message, command.Action)
		message = appendControlInt(message, command.ButtonState)
		message = appendControlInt(message, command.ActionButton)
		message = appendControlInt(message, command.DisplayID)
		if command.IsMouse {
			message = append(message, 1)
		} else {
			message = append(message, 0)
		}
	case "key":
		message = appendControlInt(message, 2)
		message = appendControlInt(message, command.Action)
		message = appendControlInt(message, command.KeyCode)
		message = appendLEB128(message, command.MetaState)
	default:
		return nil, fmt.Errorf("unsupported input type %q", command.Type)
	}
	return message, nil
}

func handleControl(conn net.Conn, reader io.Reader) {
	agentControlMu.Lock()
	agentControl = conn
	agentControlMu.Unlock()
	defer func() {
		agentControlMu.Lock()
		if agentControl == conn {
			agentControl = nil
		}
		agentControlMu.Unlock()
	}()
	_, _ = io.Copy(io.Discard, reader)
}

func sendAgentControl(message []byte) error {
	agentControlMu.Lock()
	defer agentControlMu.Unlock()
	if agentControl == nil {
		return errors.New("agent control channel is not connected")
	}
	_ = agentControl.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
	for len(message) != 0 {
		written, err := agentControl.Write(message)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		message = message[written:]
	}
	return nil
}

func controlWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(64 * 1024)
	for {
		var command inputCommand
		if err := conn.ReadJSON(&command); err != nil {
			return
		}
		message, err := encodeInputCommand(command)
		if err == nil {
			err = sendAgentControl(message)
		}
		if err != nil {
			_ = conn.WriteJSON(map[string]string{"error": err.Error()})
		}
	}
}
