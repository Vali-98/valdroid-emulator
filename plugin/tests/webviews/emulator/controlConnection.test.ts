import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useControlConnection } from '../../../src/webviews/emulator/hooks/useControlConnection';
import { MockSocket } from '../../helpers';
vi.mock('../../../src/webviews/shared/vscode', () => ({vscode: {postMessage: vi.fn()}}));

beforeEach(() => {MockSocket.instances = []; vi.stubGlobal('WebSocket', MockSocket);});

it('opens the device socket and reports connection events', () => {
	const { result } = renderHook(() => useControlConnection('http://127.0.0.1:8080', vi.fn()));
	const socket = MockSocket.instances[0]; expect(socket.url).toBe('ws://127.0.0.1:8080/control');
	act(() => socket.onopen?.()); expect(result.current.status).toBe('Emulator connected');
	act(() => socket.onerror?.()); expect(result.current.status).toBe('Input connection failed');
	act(() => socket.onclose?.()); expect(result.current.status).toBe('Input connection closed');
});
it('serializes commands only while open', () => {
	const { result } = renderHook(() => useControlConnection('http://localhost', vi.fn()));
	expect(result.current.send({ type: 'key', keyCode: 3 })).toBe(true);
	expect(MockSocket.instances[0].send).toHaveBeenCalledWith('{"type":"key","keyCode":3}');
	MockSocket.instances[0].readyState = 3;
	expect(result.current.send({ type: 'key' })).toBe(false);
});
it('closes and detaches the previous socket when changing servers', () => {
	const { rerender, unmount } = renderHook(({ url }) => useControlConnection(url, vi.fn()), { initialProps: { url: 'http://one' } });
	const previous = MockSocket.instances[0]; rerender({ url: 'http://two' });
	expect(previous.close).toHaveBeenCalledOnce(); expect(previous.onclose).toBeNull();
	unmount(); expect(MockSocket.instances[1].close).toHaveBeenCalledOnce();
});
it('debounces volume refreshes and cancels the timer on disconnect', () => {
	vi.useFakeTimers(); const refresh = vi.fn();
	const { result, unmount } = renderHook(() => useControlConnection('http://localhost', refresh));
	act(() => {result.current.sendDeviceKey(24); result.current.sendDeviceKey(25);});
	act(() => vi.advanceTimersByTime(299)); expect(refresh).not.toHaveBeenCalled();
	act(() => vi.advanceTimersByTime(1)); expect(refresh).toHaveBeenCalledOnce();
	act(() => result.current.sendDeviceKey(164)); unmount();
	act(() => vi.advanceTimersByTime(300)); expect(refresh).toHaveBeenCalledOnce();
});
it('does not refresh volume for navigation or unsent commands', () => {
	vi.useFakeTimers(); const refresh = vi.fn();
	const { result } = renderHook(() => useControlConnection('http://localhost', refresh));
	act(() => result.current.sendDeviceKey(3)); MockSocket.instances[0].readyState = 3;
	act(() => result.current.sendDeviceKey(24)); act(() => vi.advanceTimersByTime(1000));
	expect(refresh).not.toHaveBeenCalled();
});

it('cancels a pending volume refresh when the input socket closes', () => {
	vi.useFakeTimers(); const refresh = vi.fn();
	const {result} = renderHook(() => useControlConnection('http://localhost', refresh));
	act(() => {result.current.sendDeviceKey(24); MockSocket.instances[0].onclose?.();});
	act(() => vi.advanceTimersByTime(300));
	expect(refresh).not.toHaveBeenCalled();
});
