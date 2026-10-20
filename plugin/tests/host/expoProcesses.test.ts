import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { ExpoProcesses } from '../../src/host/reactNative/ExpoProcesses';

vi.mock('node:child_process', async importOriginal => ({...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn()}));

function child() {
	return Object.assign(new EventEmitter(), {stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, pid: undefined});
}

it('waits for Metro readiness before building and captures stdout, stderr and exit status', async () => {
	const metro = child(), build = child();
	vi.mocked(spawn).mockReturnValueOnce(metro as unknown as ReturnType<typeof spawn>).mockReturnValueOnce(build as unknown as ReturnType<typeof spawn>);
	let ready: ((value: Response) => void) | undefined;
	vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => {ready = resolve;})));
	let output = '';
	const processes = new ExpoProcesses(text => {output += text;});
	const starting = processes.start('/project', '/project/node_modules/expo/bin/cli', 'Pixel_9_API_35', 8087);
	expect(spawn).toHaveBeenCalledTimes(1);
	metro.stdout.write('Metro ready\n');
	ready?.({ok: true, text: async () => 'packager-status:running'} as Response);
	await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
	expect(vi.mocked(spawn).mock.calls[1][1]).toEqual(['--dns-result-order=ipv4first', '/project/node_modules/expo/bin/cli', 'run:android', '--device', 'Pixel_9_API_35', '--port', '8087']);
	build.stdout.write('build stdout\n'); build.stderr.write('build stderr\n');
	build.emit('close', 0, null);
	await starting;
	expect(output).toContain('Metro ready');
	expect(output).toContain('build stdout');
	expect(output).toContain('build stderr');
	expect(output).toContain('[Build] exited (0)');
	await processes.stop();
});

it('keeps watching enabled even when the extension inherits CI, and aligns localhost with ADB IPv4', async () => {
	vi.stubEnv('CI', '1');
	const metro = child(), build = child();
	vi.mocked(spawn).mockReturnValueOnce(metro as unknown as ReturnType<typeof spawn>).mockReturnValueOnce(build as unknown as ReturnType<typeof spawn>);
	vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, text: async () => 'packager-status:running'})));
	const processes = new ExpoProcesses(() => undefined);
	try {
		const starting = processes.start('/project', '/project/cli', 'emulator-5554', 8087);
		await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
		const [executable, args, options] = vi.mocked(spawn).mock.calls[0];
		expect(executable).toBe(process.execPath);
		expect(args).toEqual(['--dns-result-order=ipv4first', '/project/cli', 'start', '--localhost', '--port', '8087']);
		expect(options?.env).not.toHaveProperty('CI');
		expect(options?.env?.ELECTRON_RUN_AS_NODE).toBe('1');
		build.emit('close', 0, null);
		await starting;
	} finally {vi.unstubAllEnvs(); await processes.stop();}
});

it('reports Metro spawn errors before attempting a build', async () => {
	const metro = child();
	vi.mocked(spawn).mockReturnValue(metro as unknown as ReturnType<typeof spawn>);
	vi.stubGlobal('fetch', vi.fn(async () => {metro.emit('error', new Error('node executable unavailable')); throw new Error('not ready');}));
	let output = '';
	const processes = new ExpoProcesses(text => {output += text;});
	await expect(processes.start('/project', '/project/cli', 'emulator-5554', 8087)).rejects.toThrow('node executable unavailable');
	expect(output).toContain('node executable unavailable');
	expect(spawn).toHaveBeenCalledOnce();
	await processes.stop();
});

it('finishes startup when the app connects even while the Expo build CLI remains alive', async () => {
	const metro = child(), build = child();
	vi.mocked(spawn).mockReturnValueOnce(metro as unknown as ReturnType<typeof spawn>).mockReturnValueOnce(build as unknown as ReturnType<typeof spawn>);
	vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, text: async () => 'packager-status:running'})));
	let appConnected!: () => void;
	const appReady = new Promise<void>(resolve => {appConnected = resolve;});
	let output = '';
	const processes = new ExpoProcesses(text => {output += text;});
	const starting = processes.start('/project', '/project/cli', 'Phone', 8087, appReady);
	await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
	appConnected();
	await starting;
	expect(build.exitCode).toBeNull();
	expect(output).toContain('App runtime connected. Startup complete');
	// Late failures remain observed and visible rather than becoming unhandled rejections.
	build.emit('close', 1, null);
	await Promise.resolve();
	expect(output).toContain('[Build] exited (1)');
	await processes.stop();
});
