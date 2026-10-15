package server

import "sync"

// Only adjacent, unacknowledged moves are replaceable; gesture/key boundaries stay ordered.
type inputQueue struct {
	mu       sync.Mutex
	changed  *sync.Cond
	commands []inputCommand
	closed   bool
}

func newInputQueue() *inputQueue {
	queue := &inputQueue{}
	queue.changed = sync.NewCond(&queue.mu)
	return queue
}

func replaceableMove(previous, next inputCommand) bool {
	if previous.Type != "motion" || next.Type != "motion" || previous.Action != 2 || next.Action != 2 ||
		previous.RequestID != "" || next.RequestID != "" || previous.DisplayID != next.DisplayID ||
		previous.IsMouse != next.IsMouse || previous.ButtonState != next.ButtonState ||
		previous.ActionButton != next.ActionButton || len(previous.Pointers) != len(next.Pointers) {
		return false
	}
	for index, pointer := range previous.Pointers {
		if pointer.ID != next.Pointers[index].ID {
			return false
		}
	}
	return true
}

func (queue *inputQueue) push(command inputCommand) bool {
	queue.mu.Lock()
	defer queue.mu.Unlock()
	for !queue.closed {
		count := len(queue.commands)
		if count > 0 && replaceableMove(queue.commands[count-1], command) {
			queue.commands[count-1] = command
			return true
		}
		if count < 64 {
			queue.commands = append(queue.commands, command)
			queue.changed.Signal()
			return true
		}
		queue.changed.Wait()
	}
	return false
}

func (queue *inputQueue) pop() (inputCommand, bool) {
	queue.mu.Lock()
	defer queue.mu.Unlock()
	for len(queue.commands) == 0 && !queue.closed {
		queue.changed.Wait()
	}
	if len(queue.commands) == 0 {
		return inputCommand{}, false
	}
	command := queue.commands[0]
	copy(queue.commands, queue.commands[1:])
	queue.commands[len(queue.commands)-1] = inputCommand{}
	queue.commands = queue.commands[:len(queue.commands)-1]
	queue.changed.Broadcast()
	return command, true
}

func (queue *inputQueue) close() {
	queue.mu.Lock()
	queue.closed = true
	queue.changed.Broadcast()
	queue.mu.Unlock()
}
