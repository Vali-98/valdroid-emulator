// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), runFile: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../../src/host/session/process', () => ({ runFile: mocks.runFile }));
import { AdbFileTransfer } from '../../src/host/files/AdbFileTransfer';

class FakeChild extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	kill = vi.fn();
}

let child: FakeChild;
let serial: string | undefined;
let transfer: AdbFileTransfer;
beforeEach(() => {
	vi.useFakeTimers();
	serial = 'emulator-5554';
	child = new FakeChild();
	mocks.spawn.mockReset().mockReturnValue(child);
	mocks.runFile.mockReset().mockResolvedValue('');
	transfer = new AdbFileTransfer('/sdk/adb', () => serial, { appendLine: vi.fn() });
});
afterEach(() => vi.useRealTimers());
const send = (name: string, signal = new AbortController().signal, progress = vi.fn()) =>
	transfer.send('/tmp/staged/package.apk', name, 'emulator-5554', signal, progress);

it('installs case-insensitive APKs on only the active serial and never pushes them to Downloads', async () => {
	const progress = vi.fn();
	const pending = send('My App.APK', undefined, progress);
	expect(mocks.spawn).toHaveBeenCalledWith('/sdk/adb', ['-s', 'emulator-5554', 'install', '-r', '-t', '/tmp/staged/package.apk'],
		expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }));
	child.stdout.write('Performing Streamed Install\nSuc');
	child.stdout.write('cess\n'); child.emit('close', 0);
	await expect(pending).resolves.toEqual({ kind: 'installed' });
	expect(mocks.runFile).not.toHaveBeenCalled();
	expect(progress).toHaveBeenLastCalledWith(100);
	expect(vi.getTimerCount()).toBe(0);
});

it('preserves ordinary file uploads and Downloads media refresh', async () => {
	const pending = send('photo.png');
	expect(mocks.spawn).toHaveBeenCalledWith('/sdk/adb', ['-s', 'emulator-5554', 'push', '/tmp/staged/package.apk', '/sdcard/Download/photo.png'], expect.anything());
	child.emit('close', 0);
	await expect(pending).resolves.toEqual({ kind: 'download', path: '/sdcard/Download/photo.png' });
	expect(mocks.runFile).toHaveBeenCalledWith('/sdk/adb', expect.arrayContaining(['emulator-5554', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE']));
});

it('reports Android install errors without claiming success even with exit code zero', async () => {
	const pending = send('app.apk');
	child.stderr.write('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]\n'); child.emit('close', 0);
	await expect(pending).rejects.toThrow('INSTALL_FAILED_UPDATE_INCOMPATIBLE');
	expect(vi.getTimerCount()).toBe(0);
});

it('rejects a nonzero exit even if prior output contained Success', async () => {
	const pending = send('app.apk');
	child.stdout.write('Success\n'); child.emit('close', 1);
	await expect(pending).rejects.toThrow('ADB install failed');
});

it('refuses canceled or stale-device installs without starting adb', async () => {
	const controller = new AbortController(); controller.abort();
	await expect(send('app.apk', controller.signal)).rejects.toThrow('canceled');
	serial = 'different';
	await expect(send('app.apk')).rejects.toThrow('no longer connected');
	expect(mocks.spawn).not.toHaveBeenCalled();
});

it('does not claim installation succeeded after the device changes', async () => {
	const pending = send('app.apk'); serial = undefined;
	child.stdout.write('Success\n'); child.emit('close', 0);
	await expect(pending).rejects.toThrow('Device disconnected');
});

it('forwards cancellation to adb and clears the process timer', async () => {
	const controller = new AbortController();
	const pending = send('app.apk', controller.signal);
	expect(mocks.spawn.mock.calls[0][2].signal).toBe(controller.signal);
	controller.abort(); child.emit('error', new Error('aborted'));
	await expect(pending).rejects.toThrow('Upload canceled');
	expect(vi.getTimerCount()).toBe(0);
});

it('kills stalled installs on timeout', async () => {
	const pending = send('app.apk');
	const rejection = expect(pending).rejects.toThrow('ADB installation timed out');
	await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
	await rejection;
	expect(child.kill).toHaveBeenCalledOnce();
});
