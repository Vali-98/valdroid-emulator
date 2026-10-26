import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {expect, it, vi} from 'vitest';
import {ExpoProcesses} from '../../src/host/reactNative/ExpoProcesses';
import {readAndroidArtifact} from '../../src/host/reactNative/AndroidArtifact';

vi.mock('node:child_process', async original => ({...await original<typeof import('node:child_process')>(), spawn: vi.fn()}));
vi.mock('../../src/host/reactNative/AndroidArtifact', () => ({readAndroidArtifact: vi.fn(async () => ({apkPath: '/storage/artifact.apk', applicationId: 'com.example.app'}))}));
const lifecycle = {runner: '/extension/expo-lifecycle.cjs', stateFile: '/storage/build.json', serial: 'emulator-5554', adbPath: '/sdk/adb'};
function child() {return Object.assign(new EventEmitter(), {stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, pid: undefined});}
function children(count: number) {
	const items = Array.from({length: count}, child);
	for (const item of items) {vi.mocked(spawn).mockReturnValueOnce(item as unknown as ReturnType<typeof spawn>);}
	return items;
}
const ready = () => vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, text: async () => 'packager-status:running'})));

it('interrupts app startup on a bundle error but keeps Metro available for recovery', async () => {
	const [build, install, metro, launch] = children(4); ready();
	const onBundle = vi.fn();
	const processes = new ExpoProcesses(() => undefined, () => undefined, undefined, undefined, onBundle);
	const starting = processes.start('/project', '/project/cli', 'Phone', 8087, lifecycle, new Promise(() => undefined));
	const rejected = expect(starting).rejects.toThrow('Unexpected token');
	build.emit('close', 0, null);
	await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2)); install.emit('close', 0, null);
	await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(4)); launch.emit('close', 0, null);
	metro.emit('message', {type: 'valdroid-bundle-error', message: 'Unexpected token', file: '/project/app.tsx', line: 3, column: 2});
	await rejected;
	expect(metro.exitCode).toBeNull();
	expect(onBundle).toHaveBeenCalledWith({message: 'Unexpected token', file: '/project/app.tsx', line: 3, column: 3});
	metro.emit('message', {type: 'valdroid-bundle-ready'});
	expect(() => processes.throwBundleFailure()).not.toThrow();
	expect(onBundle).toHaveBeenLastCalledWith();
	await processes.stop();
});

it('requests cache reset only for an explicit Metro cache reset', async () => {
	children(1); ready();
	const processes = new ExpoProcesses(() => undefined);
	await processes.startMetro('/project', '/project/cli', 8087, true);
	expect(vi.mocked(spawn).mock.calls[0][1]).toContain('--clear');
	await processes.stop();
});

it('runs clean rebuild through the dedicated build phase, not Expo prebuild --clean', async () => {
	const [build] = children(1);
	const processes = new ExpoProcesses(() => undefined);
	const building = processes.buildAPK('/project', '/project/cli', 'Phone', 8087, lifecycle, true);
	expect(vi.mocked(spawn).mock.calls[0][1]).toContain('clean-build');
	expect(vi.mocked(spawn).mock.calls[0][1]).not.toContain('--clean');
	build.emit('close', 0, null);
	await building;
});

it('runs build → data-preserving install → Metro → launch in separate processes and retains their output', async () => {
	const [build, install, metro, launch] = children(4); ready();
	let output = ''; const progress = vi.fn();
	const processes = new ExpoProcesses(text => {output += text;}, progress);
	const starting = processes.start('/project', '/project/cli', 'Phone', 8087, lifecycle, Promise.resolve());
	expect(spawn).toHaveBeenCalledOnce();
	expect(vi.mocked(spawn).mock.calls[0][1]).toContain('build');
	build.stdout.write('Build stdout\n'); build.stderr.write('Build stderr\n'); build.emit('close', 0, null);
	await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
	expect(vi.mocked(spawn).mock.calls[1].slice(0, 2)).toEqual(['/sdk/adb', ['-s', 'emulator-5554', 'install', '-r', '-t', '/storage/artifact.apk']]);
	install.emit('close', 0, null);
	await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(4));
	expect(vi.mocked(spawn).mock.calls[2][1]).toContain('start');
	expect(vi.mocked(spawn).mock.calls[3][1]).toContain('launch');
	launch.emit('close', 0, null); await starting;
	expect(progress.mock.calls.map(args => args[0])).toEqual(['Building…', 'Installing…', 'Starting Metro…', 'Launching…', 'Connecting…']);
	expect(output).toContain('Build stdout'); expect(output).toContain('Build stderr');
	expect(output).toContain('[Install] exited (0)'); expect(output).toContain('Metro remains running');
	expect(metro.exitCode).toBeNull(); await processes.stop();
});

it('does not install or start Metro after a failed build, even if an app-ready signal arrives early', async () => {
	const [build] = children(1);
	const processes = new ExpoProcesses(() => undefined);
	const starting = processes.start('/project', '/project/cli', 'Phone', 8087, lifecycle, Promise.resolve());
	build.emit('close', 1, null);
	await expect(starting).rejects.toThrow('Build exited (1)');
	expect(spawn).toHaveBeenCalledOnce(); await processes.stop();
});

it('never uninstalls, clears data, or launches after a rejected installation', async () => {
	const [install] = children(1);
	const processes = new ExpoProcesses(() => undefined);
	const installing = processes.installAPK('/project', 8087, lifecycle);
	await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
	install.stderr.write('INSTALL_FAILED_UPDATE_INCOMPATIBLE'); install.emit('close', 1, null);
	await expect(installing).rejects.toThrow('Install exited (1)');
	expect(spawn).toHaveBeenCalledOnce();
	expect(readAndroidArtifact).toHaveBeenCalledWith('/storage/build.json', '/project', 'emulator-5554', 8087);
	await processes.stop();
});

it('keeps watch mode and injection confined to Metro, with IPv4 localhost', async () => {
	vi.stubEnv('CI', '1');
	const [metro] = children(1); ready();
	const processes = new ExpoProcesses(() => undefined, () => undefined, '/extension/reporter.cjs', {preload: '/extension/preload.cjs', sessionFile: '/storage/session.json'});
	try {
		await processes.startMetro('/project', '/project/cli', 8087);
		const [, args, options] = vi.mocked(spawn).mock.calls[0];
		expect(args).toEqual(['--dns-result-order=ipv4first', '--require', '/extension/reporter.cjs', '--require', '/extension/preload.cjs', '/project/cli', 'start', '--localhost', '--port', '8087']);
		expect(options?.env).not.toHaveProperty('CI'); expect(options?.env?.VALDROID_METRO_SESSION).toBe('/storage/session.json');
		expect(metro.exitCode).toBeNull();
	} finally {vi.unstubAllEnvs(); await processes.stop();}
});

it('reports Metro spawn failures without waiting for readiness timeout', async () => {
	const [metro] = children(1);
	vi.stubGlobal('fetch', vi.fn(async () => {metro.emit('error', new Error('node unavailable')); throw new Error('not ready');}));
	const processes = new ExpoProcesses(() => undefined);
	await expect(processes.startMetro('/project', '/project/cli', 8087)).rejects.toThrow('node unavailable');
	await processes.stop();
});
