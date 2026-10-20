// @vitest-environment node
import {expect, it, vi} from 'vitest';
import {EmulatorSession} from '../../src/host/session/EmulatorSession';
import {runFile} from '../../src/host/session/process';
vi.mock('../../src/host/session/process', async original => ({...await original<typeof import('../../src/host/session/process')>(), runFile: vi.fn(async () => 'device\n')}));
function fixture() {
	const progress = vi.fn();
	const session = new EmulatorSession('/extension', 'adb', 'emulator', 1000, {appendLine: vi.fn()} as any, {setLaunchProgress: progress} as any);
	const internal = session as any;
	const emulator = {owned: true};
	internal.activeSerial = 'emulator-5554'; internal.emulatorProcess = emulator;
	const stop = vi.spyOn(internal, 'stopServer').mockImplementation(async () => {internal.activeSerial = undefined;});
	const start = vi.spyOn(internal, 'startServer').mockResolvedValue(undefined);
	vi.spyOn(internal, 'deviceName').mockResolvedValue('Phone');
	return {session, internal, emulator, stop, start, progress};
}
it('restarts only the server/agent for the same device and retains emulator ownership', async () => {
	const {session, internal, emulator, stop, start, progress} = fixture();
	await session.reconnect();
	expect(stop).toHaveBeenCalledWith(false);
	expect(runFile).toHaveBeenCalledWith('adb', ['-s', 'emulator-5554', 'get-state'], expect.anything());
	expect(start).toHaveBeenCalledWith('emulator-5554', 'Phone', expect.any(AbortSignal));
	expect(internal.emulatorProcess).toBe(emulator);
	expect(progress).toHaveBeenCalledWith('Reconnecting device…');
});
it('does not launch a new emulator when a device is offline', async () => {
	const {session, start, internal, emulator} = fixture();
	vi.mocked(runFile).mockResolvedValueOnce('offline');
	await expect(session.reconnect()).rejects.toThrow('not available');
	expect(start).not.toHaveBeenCalled(); expect(internal.emulatorProcess).toBe(emulator);
});
it('refuses overlapping device initialization', async () => {
	const {session, internal, stop} = fixture(); internal.startup = new AbortController();
	await expect(session.reconnect()).rejects.toThrow('current device operation'); expect(stop).not.toHaveBeenCalled();
});
