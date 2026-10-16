// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleMessage } from '../../src/shared/console';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), runFile: vi.fn(), terminate: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../../src/host/session/process', () => ({ runFile: mocks.runFile, terminateProcess: mocks.terminate }));
import { AdbConsole } from '../../src/host/adb/AdbConsole';

class FakeChild extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
}

describe('ADB console lifecycle', () => {
	let children: FakeChild[];
	let messages: ConsoleMessage[];
	let console: AdbConsole;
	beforeEach(() => {
		vi.useFakeTimers(); children = []; messages = [];
		mocks.spawn.mockImplementation(() => { const child = new FakeChild(); children.push(child); return child; });
		mocks.runFile.mockImplementation((_path: string, args: string[]) => Promise.resolve(args.includes('packages') ? 'package:dev.test\n' : 'PID NAME\n123 dev.test\n'));
		mocks.terminate.mockImplementation(async (child: FakeChild) => { child.emit('close', null); });
		console = new AdbConsole('/sdk/adb', message => messages.push(message));
	});
	afterEach(async () => { await console.dispose(); vi.useRealTimers(); });
	it('starts serial-scoped logcat and batches structured records', async () => {
		await console.selectDevice('emulator-5554');
		expect(mocks.spawn).toHaveBeenCalledWith('/sdk/adb', ['-s', 'emulator-5554', 'logcat', '-v', 'threadtime', '-T', '200', '*:V'], expect.anything());
		children[0].stdout.write('10-15 12:34:56.789 123 124 E TestTag: broken\n');
		await vi.advanceTimersByTimeAsync(100);
		expect(messages).toContainEqual(expect.objectContaining({ type: 'console-records', records: [expect.objectContaining({ text: 'broken', level: 'E', packageName: 'dev.test' })] }));
	});
	it('executes quoted commands without a host shell and resets busy state', async () => {
		await console.selectDevice('emulator-5554');
		await console.execute('shell echo "$PATH" | head -c 20');
		expect(mocks.spawn).toHaveBeenLastCalledWith('/sdk/adb', ['-s', 'emulator-5554', 'shell', 'echo "$PATH" | head -c 20'], expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }));
		children[1].stdout.write('result\n'); children[1].emit('close', 0);
		expect(console.snapshot()).toMatchObject({ state: { busy: false }, records: expect.arrayContaining([expect.objectContaining({ kind: 'output', text: 'result' })]) });
	});
	it('kills both old processes and ignores late output when switching devices', async () => {
		await console.selectDevice('first'); await console.execute('get-state');
		const old = children[0];
		await console.selectDevice('second');
		expect(mocks.terminate).toHaveBeenCalledWith(old);
		expect(mocks.terminate).toHaveBeenCalledWith(children[1]);
		old.stdout.write('stale log\n');
		expect(console.snapshot()).toMatchObject({ state: { serial: 'second' }, records: [] });
	});
	it('recovers from process errors and resumes logcat', async () => {
		await console.selectDevice('device');
		children[0].emit('error', new Error('disconnected')); children[0].emit('close', 1);
		await console.toggle();
		expect(children).toHaveLength(2);
		expect(console.snapshot()).toMatchObject({ state: { streaming: true } });
	});
	it('clearing removes pending batches without clearing the Android log buffer', async () => {
		await console.selectDevice('device'); children[0].stdout.write('old\n');
		console.clear(); messages = [];
		await vi.advanceTimersByTimeAsync(100);
		expect(messages).toEqual([]);
		expect(mocks.spawn).toHaveBeenCalledTimes(1);
	});
	it('bounds scrollback and refuses work after disposal', async () => {
		for (let i = 0; i < 6000; i++) { console.notice(String(i)); }
		expect(console.snapshot()).toMatchObject({ records: expect.arrayContaining([expect.objectContaining({ text: '5999' })]) });
		expect((console.snapshot() as { records: unknown[] }).records).toHaveLength(5000);
		await console.dispose(); await console.selectDevice('device');
		expect(mocks.spawn).not.toHaveBeenCalled();
	});
	it('retains diagnostic scrollback when the device disconnects', async () => {
		await console.selectDevice('device');
		children[0].stdout.write('last diagnostic line\n');
		await console.selectDevice(undefined);
		expect(console.snapshot()).toMatchObject({ state: { serial: undefined, streaming: false }, records: expect.arrayContaining([expect.objectContaining({ text: 'last diagnostic line' })]) });
	});
});
