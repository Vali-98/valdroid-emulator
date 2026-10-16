import { beforeEach, expect, it, vi } from 'vitest';
import { createControlSender } from '../../../src/webviews/emulator/input/controlSender';

let socket: { readyState: number; bufferedAmount: number; send: ReturnType<typeof vi.fn> };
beforeEach(() => {vi.useFakeTimers(); vi.stubGlobal('WebSocket', { OPEN: 1 }); socket = { readyState: 1, bufferedAmount: 0, send: vi.fn() };});
const move = (x: number) => ({ type: 'motion', action: 2, x });

it('replaces queued moves under backpressure without delaying touch boundaries', () => {
	const sender = createControlSender(socket as unknown as WebSocket);
	socket.bufferedAmount = 100;
	for (let x = 0; x < 1000; x++) sender.send(move(x));
	expect(socket.send).not.toHaveBeenCalled();
	socket.bufferedAmount = 0; vi.advanceTimersByTime(5);
	expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify(move(999)));
	sender.send(move(1000)); sender.send({ type: 'motion', action: 1 });
	vi.advanceTimersByTime(100);
	expect(socket.send).toHaveBeenCalledTimes(2);
	expect(socket.send).toHaveBeenLastCalledWith('{"type":"motion","action":1}');
	sender.dispose();
});

it('sends down and key events synchronously and clears timers on disposal', () => {
	const sender = createControlSender(socket as unknown as WebSocket);
	socket.bufferedAmount = 100;
	sender.send(move(1)); sender.send({ type: 'motion', action: 0 }); sender.send({ type: 'key', keyCode: 3 });
	expect(socket.send).toHaveBeenCalledTimes(2);
	sender.send(move(2)); sender.dispose();
	vi.advanceTimersByTime(100); expect(socket.send).toHaveBeenCalledTimes(2);
});

it('refuses closed sockets and catches send failures', () => {
	const sender = createControlSender(socket as unknown as WebSocket);
	socket.readyState = 3; expect(sender.send(move(1))).toBe(false);
	socket.readyState = 1; socket.send.mockImplementation(() => {throw new Error('closed');});
	expect(sender.send({ type: 'key' })).toBe(false); sender.dispose();
});

it('sends the first move immediately and bounds subsequent move frequency', () => {
	const sender = createControlSender(socket as unknown as WebSocket);
	sender.send(move(0)); expect(socket.send).toHaveBeenCalledOnce();
	for (let x = 1; x <= 1000; x++) sender.send(move(x));
	expect(socket.send).toHaveBeenCalledOnce();
	vi.advanceTimersByTime(9);
	expect(socket.send).toHaveBeenCalledTimes(2);
	expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify(move(1000))); sender.dispose();
});
