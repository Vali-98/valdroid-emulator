// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { monitorSession } from '../../src/host/session/monitorSession';

const mocks = vi.hoisted(() => ({run: vi.fn(), fetch: vi.fn()}));
vi.mock('../../src/host/session/process', () => ({runFile: mocks.run}));
beforeEach(() => {
	vi.useFakeTimers(); mocks.run.mockReset().mockResolvedValue('device\n');
	mocks.fetch.mockReset().mockResolvedValue({ok: true, json: async () => ({videoConnected: true, controlConnected: true})});
	vi.stubGlobal('fetch', mocks.fetch);
});

it('keeps a static display connected and cancels monitoring on teardown', async () => {
	const disconnected = vi.fn(); const stop = monitorSession('adb', 'emulator-5554', 'http://localhost', disconnected);
	await vi.advanceTimersByTimeAsync(8000); expect(disconnected).not.toHaveBeenCalled();
	stop(); const checks = mocks.fetch.mock.calls.length;
	await vi.advanceTimersByTimeAsync(8000); expect(mocks.fetch).toHaveBeenCalledTimes(checks);
	expect(vi.getTimerCount()).toBe(0);
});

it('reports device loss once after consecutive failed checks', async () => {
	mocks.run.mockRejectedValue(new Error('device not found'));
	const disconnected = vi.fn(); const stop = monitorSession('adb', 'emulator-5554', 'http://localhost', disconnected);
	await vi.advanceTimersByTimeAsync(2000); expect(disconnected).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(6000);
	expect(disconnected).toHaveBeenCalledExactlyOnceWith('Device emulator-5554 disconnected or is unavailable.'); stop();
});

it('ignores a transient channel failure but disconnects when the agent stays down', async () => {
	const unhealthy = {ok: true, json: async () => ({videoConnected: false, controlConnected: true})};
	mocks.fetch.mockResolvedValueOnce(unhealthy);
	const disconnected = vi.fn(); const stop = monitorSession('adb', 'emulator-5554', 'http://localhost', disconnected);
	await vi.advanceTimersByTimeAsync(4000); expect(disconnected).not.toHaveBeenCalled();
	mocks.fetch.mockResolvedValue(unhealthy);
	await vi.advanceTimersByTimeAsync(4000);
	expect(disconnected).toHaveBeenCalledExactlyOnceWith('Android agent disconnected.'); stop();
});

it('aborts in-flight requests and ignores late responses after teardown', async () => {
	let resolve!: (value: object) => void;
	mocks.fetch.mockImplementation(() => new Promise(done => {resolve = done;}));
	const disconnected = vi.fn(); const stop = monitorSession('adb', 'emulator-5554', 'http://localhost', disconnected);
	await vi.advanceTimersByTimeAsync(2000); stop();
	expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
	resolve({ok: false}); await vi.advanceTimersByTimeAsync(6000);
	expect(disconnected).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
