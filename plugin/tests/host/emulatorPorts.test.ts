// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type * as vscode from 'vscode';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmulatorViewProvider } from '../../src/host/views/EmulatorViewProvider';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), runFile: vi.fn(), terminate: vi.fn(), fetch: vi.fn(), delay: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('../../src/host/session/process', () => ({
	platformTarget: () => 'darwin-arm64', runFile: mocks.runFile, terminateProcess: mocks.terminate,
	delay: mocks.delay, waitForExit: async () => undefined,
}));
import { EmulatorSession } from '../../src/host/session/EmulatorSession';

class FakeChild extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	killed = false;
	exit(code: number) {this.exitCode = code; this.emit('exit', code, null);}
}

let child: FakeChild;
let session: EmulatorSession;
const provider = { setServer: vi.fn(), setStatus: vi.fn(), notify: vi.fn(), refreshTargets: vi.fn(async () => undefined) };
beforeEach(() => {
	child = new FakeChild();
	mocks.spawn.mockReset().mockReturnValue(child);
	mocks.runFile.mockReset().mockResolvedValue('');
	mocks.delay.mockReset().mockResolvedValue(undefined);
	mocks.terminate.mockReset().mockImplementation(async () => child.exit(0));
	mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ videoConnected: true, controlConnected: true }) });
	vi.stubGlobal('fetch', mocks.fetch);
	provider.setServer.mockReset(); provider.setStatus.mockReset();
	provider.notify.mockReset(); provider.refreshTargets.mockClear();
	session = new EmulatorSession('/extension', '/sdk/adb', '/sdk/emulator', 10000000,
		{ append: vi.fn(), appendLine: vi.fn() } as unknown as vscode.OutputChannel,
		provider as unknown as EmulatorViewProvider);
});
afterEach(async () => {await session.stop(); child.stdout.destroy(); child.stderr.destroy();});

it('starts with uncommon preferred ports and connects only to its announced fallback URL', async () => {
	const started = session.startTarget('device:physical-device');
	await Promise.resolve();
	expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
		'--http', '127.0.0.1:38475', '--socket', '127.0.0.1:38476', '--auto-port', '--announce-listeners',
	]), expect.anything());
	child.stdout.write('{"type":"server-listening","httpUrl":"http://127.0.0.1:54321","socketAddress":"127.0.0.1:54322"}\n');
	await started;
	expect(mocks.fetch).toHaveBeenCalledWith('http://127.0.0.1:54321/api/status', expect.objectContaining({ signal: expect.any(AbortSignal) }));
	expect(provider.setServer).toHaveBeenCalledWith('http://127.0.0.1:54321', 'physical-device');
	expect(session.deviceSerial).toBe('physical-device');
});

it('does not poll another server when its own process fails before announcing', async () => {
	const started = session.startTarget('device:physical-device');
	const rejection = expect(started).rejects.toThrow('before announcing its ports');
	await Promise.resolve(); child.exit(1);
	await rejection;
	expect(mocks.fetch).not.toHaveBeenCalled();
	expect(session.deviceSerial).toBeUndefined();
	expect(mocks.runFile).toHaveBeenCalledWith('/sdk/adb', ['-s', 'physical-device', 'shell', expect.stringContaining('rm -f /data/local/tmp/screen-sharing-agent.jar')], {timeout: 5000});
});

it('removes the remote agent after stopping the server and before removing the reverse mapping', async () => {
	const started = session.startTarget('device:physical-device');
	await Promise.resolve();
	child.stdout.write('{"type":"server-listening","httpUrl":"http://127.0.0.1:54321","socketAddress":"127.0.0.1:54322"}\n');
	await started;
	mocks.runFile.mockClear();
	await session.stop();
	const cleanup = mocks.runFile.mock.calls[0];
	expect(cleanup).toEqual(['/sdk/adb', ['-s', 'physical-device', 'shell', expect.stringContaining('/proc/$pid/cmdline')], {timeout: 5000}]);
	expect(cleanup[1][3]).toContain('/data/local/tmp/.studio/libscreen-sharing-agent.so');
	expect(mocks.terminate.mock.invocationCallOrder[0]).toBeLessThan(mocks.runFile.mock.invocationCallOrder[0]);
	expect(mocks.runFile.mock.calls[1][1]).toEqual(['-s', 'physical-device', 'reverse', '--remove', 'localabstract:screen-sharing-agent']);
});

it('finishes disconnecting when the device is unreachable during agent cleanup', async () => {
	const started = session.startTarget('device:physical-device');
	await Promise.resolve();
	child.stdout.write('{"type":"server-listening","httpUrl":"http://127.0.0.1:54321","socketAddress":"127.0.0.1:54322"}\n');
	await started;
	mocks.runFile.mockRejectedValue(new Error('Device not found'));
	await session.disconnect('Device unplugged');
	expect(session.deviceSerial).toBeUndefined();
	expect(provider.refreshTargets).toHaveBeenCalledOnce();
});

it('cancels startup while stopping without reconnecting from a late announcement', async () => {
	const started = session.startTarget('device:physical-device');
	await Promise.resolve();
	await session.stop(); await started;
	expect(session.deviceSerial).toBeUndefined(); expect(mocks.fetch).not.toHaveBeenCalled();
	expect(provider.notify).not.toHaveBeenCalled();
});

it('returns to the picker with a notice when a connected server exits unexpectedly', async () => {
	const started = session.startTarget('device:physical-device');
	await Promise.resolve();
	child.stdout.write('{"type":"server-listening","httpUrl":"http://127.0.0.1:54321","socketAddress":"127.0.0.1:54322"}\n');
	await started; child.exit(1);
	expect(provider.setServer).toHaveBeenLastCalledWith(undefined);
	expect(provider.notify).toHaveBeenCalledWith('Control server exited (1).', 'error');
	await vi.waitFor(() => expect(provider.refreshTargets).toHaveBeenCalledOnce());
	expect(session.deviceSerial).toBeUndefined();
});

it('detects a device disconnected during agent initialization instead of waiting for the startup timeout', async () => {
	vi.useFakeTimers();
	mocks.fetch.mockResolvedValue({ok: true, json: async () => ({videoConnected: false, controlConnected: false})});
	mocks.runFile.mockRejectedValue(new Error('Device not found'));
	mocks.delay.mockImplementation(async ms => {vi.setSystemTime(Date.now() + ms);});
	const started = session.startTarget('device:physical-device');
	const rejected = expect(started).rejects.toThrow('Device physical-device disconnected while initializing.');
	await Promise.resolve();
	child.stdout.write('{"type":"server-listening","httpUrl":"http://127.0.0.1:54321","socketAddress":"127.0.0.1:54322"}\n');
	await rejected;
	expect(session.deviceSerial).toBeUndefined();
});

it('connects to the matching running AVD instead of the first available device', async () => {
	mocks.runFile.mockImplementation(async (_file, args: string[]) => {
		if (args[0] === 'devices') {return 'List of devices attached\nphysical\tdevice\nemulator-5554\tdevice\nemulator-5556\tdevice\n';}
		if (args.includes('name')) {return args[1] === 'emulator-5556' ? 'Phone\nOK\n' : 'Other\nOK\n';}
		return '';
	});
	const started = session.startTarget('avd:Phone');
	await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
	expect(mocks.spawn).toHaveBeenCalledWith(expect.stringContaining('control-server'), expect.arrayContaining(['--device-serial', 'emulator-5556']), expect.anything());
	child.stdout.write('{"type":"server-listening","httpUrl":"http://127.0.0.1:54321","socketAddress":"127.0.0.1:54322"}\n');
	await started;
	expect(session.deviceSerial).toBe('emulator-5556');
});

it('launches the requested AVD and waits for its identity when another emulator is running', async () => {
	let scans = 0;
	const emulator = new FakeChild();
	mocks.spawn.mockReturnValueOnce(emulator).mockReturnValue(child);
	mocks.runFile.mockImplementation(async (_file, args: string[]) => {
		if (args[0] === 'devices') {return ++scans === 1 ? 'List of devices attached\nemulator-5554\tdevice\n' : 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n';}
		if (args.includes('name')) {return args[1] === 'emulator-5556' ? 'Phone\nOK\n' : 'Other\nOK\n';}
		if (args.includes('sys.boot_completed')) {return '1';}
		return '';
	});
	const started = session.startTarget('avd:Phone');
	await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
	expect(mocks.spawn.mock.calls[0][1]).toEqual(['-avd', 'Phone', '-no-window', '-gpu', 'host']);
	expect(mocks.spawn.mock.calls[1][1]).toEqual(expect.arrayContaining(['--device-serial', 'emulator-5556']));
	child.stdout.write('{"type":"server-listening","httpUrl":"http://127.0.0.1:54321","socketAddress":"127.0.0.1:54322"}\n');
	await started;
	expect(session.deviceSerial).toBe('emulator-5556');
	emulator.stdout.destroy(); emulator.stderr.destroy();
});
