// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type * as vscode from 'vscode';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmulatorViewProvider } from '../../src/host/views/EmulatorViewProvider';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), runFile: vi.fn(), terminate: vi.fn(), fetch: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('../../src/host/session/process', () => ({
	platformTarget: () => 'darwin-arm64', runFile: mocks.runFile, terminateProcess: mocks.terminate,
	delay: async () => undefined, waitForExit: async () => undefined,
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
const provider = { setServer: vi.fn(), setStatus: vi.fn() };
beforeEach(() => {
	child = new FakeChild();
	mocks.spawn.mockReset().mockReturnValue(child);
	mocks.runFile.mockReset().mockResolvedValue('');
	mocks.terminate.mockReset().mockImplementation(async () => child.exit(0));
	mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ videoConnected: true, controlConnected: true }) });
	vi.stubGlobal('fetch', mocks.fetch);
	provider.setServer.mockReset(); provider.setStatus.mockReset();
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
});
