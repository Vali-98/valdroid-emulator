package server

import (
	"testing"
	"time"
)

func TestInputQueueKeepsGestureBoundariesAndNewestMove(t *testing.T) {
	queue := newInputQueue()
	queue.push(inputCommand{Type: "motion", Action: 0})
	for x := int32(0); x < 1000; x++ {
		queue.push(inputCommand{Type: "motion", Action: 2, Pointers: []motionPointer{{X: x, ID: 0}}})
	}
	queue.push(inputCommand{Type: "motion", Action: 1})
	queue.close()
	for index, action := range []int32{0, 2, 1} {
		command, ok := queue.pop()
		if !ok || command.Action != action {
			t.Fatalf("command %d = %+v", index, command)
		}
		if action == 2 && command.Pointers[0].X != 999 {
			t.Fatal("did not retain newest position")
		}
	}
	if _, open := queue.pop(); open {
		t.Fatal("closed queue should finish after draining")
	}
}

func TestInputQueueDoesNotReplaceKeysOrAcknowledgedMoves(t *testing.T) {
	queue := newInputQueue()
	for _, command := range []inputCommand{{Type: "motion", Action: 2}, {Type: "key", KeyCode: 3}, {Type: "motion", Action: 2, RequestID: "one"}, {Type: "motion", Action: 2, RequestID: "two"}, {Type: "motion", Action: 3}} {
		queue.push(command)
	}
	queue.close()
	for index := 0; index < 5; index++ {
		if _, ok := queue.pop(); !ok {
			t.Fatalf("lost boundary %d", index)
		}
	}
}

func TestInputQueueCloseReleasesBlockedReaderAndProducer(t *testing.T) {
	full, empty := newInputQueue(), newInputQueue()
	for index := 0; index < 64; index++ {
		full.push(inputCommand{Type: "key"})
	}
	done := make(chan struct{}, 2)
	go func() { full.push(inputCommand{Type: "key"}); done <- struct{}{} }()
	go func() { empty.pop(); done <- struct{}{} }()
	full.close()
	empty.close()
	for index := 0; index < 2; index++ {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("queue shutdown blocked")
		}
	}
}

func TestInputQueueDoesNotMergeDifferentPointerOrDisplayState(t *testing.T) {
	previous := inputCommand{Type: "motion", Action: 2, Pointers: []motionPointer{{ID: 0}}}
	for _, next := range []inputCommand{
		{Type: "motion", Action: 2, DisplayID: 1, Pointers: []motionPointer{{ID: 0}}},
		{Type: "motion", Action: 2, Pointers: []motionPointer{{ID: 1}}},
		{Type: "motion", Action: 2, ButtonState: 1, Pointers: []motionPointer{{ID: 0}}},
		{Type: "motion", Action: 2, IsMouse: true, Pointers: []motionPointer{{ID: 0}}},
	} {
		if replaceableMove(previous, next) {
			t.Fatalf("merged incompatible state: %+v", next)
		}
	}
}
