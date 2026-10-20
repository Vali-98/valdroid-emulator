import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { delay, runFile, waitForExit } from '../session/process';
import * as path from 'node:path';
import {readAndroidArtifact} from './AndroidArtifact';

export interface ExpoLifecycleOptions {runner: string; stateFile: string; adbPath: string; serial: string;}

export class ExpoProcesses {
	private readonly children = new Set<ChildProcess>();
	private readonly abort = new AbortController();
	private metro?: ChildProcess;
	async stopMetro(): Promise<void> {
		const child = this.metro;
		if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {return;}
		if (process.platform === 'win32') {await runFile('taskkill', ['/PID', String(child.pid), '/T', '/F']);}
		else {process.kill(-child.pid, 'SIGTERM'); await waitForExit(child, 3000); if (child.exitCode === null && child.signalCode === null) {process.kill(-child.pid, 'SIGKILL'); await waitForExit(child, 3000);}}
		this.metro = undefined;
	}
	constructor(private readonly log: (text: string) => void, private readonly onProgress: (status: string) => void = () => undefined, private readonly reporterPreload?: string, private readonly injection?: {preload: string; sessionFile: string}) {}

	async start(root: string, cli: string, deviceName: string, port: number, lifecycle: ExpoLifecycleOptions, appReady?: Promise<void>): Promise<void> {
		this.onProgress('Building…');
		await this.buildAPK(root, cli, deviceName, port, lifecycle);
		this.onProgress('Installing…');
		await this.installAPK(root, port, lifecycle);
		this.onProgress('Starting Metro…');
		const metro = await this.startMetro(root, cli, port);
		this.onProgress('Launching…');
		await this.launchApp(root, cli, deviceName, port, lifecycle);
		if (appReady) {
			this.onProgress('Connecting…');
			let timer: ReturnType<typeof setTimeout> | undefined;
			let aborted = () => undefined as void;
			await new Promise<void>((resolve, reject) => {
				timer = setTimeout(() => reject(new Error('App did not connect within 90 seconds. See the Metro tab.')), 90000);
				aborted = () => reject(new Error('Expo startup canceled.'));
				this.abort.signal.addEventListener('abort', aborted, {once: true});
				if (this.abort.signal.aborted) {aborted();}
				void appReady.then(resolve, reject);
				void metro.done.then(() => reject(new Error('Metro exited before the app connected.')), reject);
			}).finally(() => {clearTimeout(timer); this.abort.signal.removeEventListener('abort', aborted);});
		}
		this.abort.signal.throwIfAborted();
		if (metro.child.exitCode !== null || metro.child.signalCode !== null) {throw new Error('Metro exited during app launch.');}
		this.log('\n[Valdroid] App startup complete. Metro remains running.\n');
	}

	async buildAPK(root: string, cli: string, deviceName: string, port: number, lifecycle: ExpoLifecycleOptions, clean = false): Promise<void> {
		await this.launch(root, lifecycle.runner, [clean ? 'clean-build' : 'build', lifecycle.stateFile, root, cli, deviceName, lifecycle.serial, String(port)], 'Build').done;
	}
	async installAPK(root: string, port: number, lifecycle: ExpoLifecycleOptions): Promise<void> {
		this.abort.signal.throwIfAborted();
		const artifact = await readAndroidArtifact(lifecycle.stateFile, root, lifecycle.serial, port);
		this.log(`[Valdroid] Installing ${artifact.applicationId}, retaining app data.\n`);
		await this.launchCommand(root, lifecycle.adbPath, ['-s', lifecycle.serial, 'install', '-r', '-t', artifact.apkPath], 'Install').done;
	}
	async launchApp(root: string, cli: string, deviceName: string, port: number, lifecycle: ExpoLifecycleOptions): Promise<void> {
		await this.launch(root, lifecycle.runner, ['launch', lifecycle.stateFile, root, cli, deviceName, lifecycle.serial, String(port)], 'Launch').done;
	}
	async startMetro(root: string, cli: string, port: number, clear = false) {
		const metro = this.launch(root, cli, ['start', '--localhost', '--port', String(port), ...(clear ? ['--clear'] : [])], 'Metro');
		this.metro = metro.child;
		// Observe the long-running process immediately, including failures before readiness.
		let metroError: Error | undefined;
		void metro.done.catch(error => {metroError = error;});
		const deadline = Date.now() + 90000;
		let ready = false;
		let lastStatus = 'No response received';
		while (Date.now() < deadline) {
			this.abort.signal.throwIfAborted();
			if (metroError) {throw metroError;}
			if (metro.child.exitCode !== null || metro.child.signalCode !== null) {throw new Error('Metro exited before becoming ready. See the Metro tab.');}
			try {
				const response = await fetch(`http://127.0.0.1:${port}/status`, {signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(1500)])});
				const body = await response.text();
				ready = response.ok && body.includes('packager-status:running');
				lastStatus = `HTTP ${response.status}: ${body.slice(0, 200)}`;
			} catch (error) {
				this.abort.signal.throwIfAborted();
				lastStatus = error instanceof Error ? `${error.message}${error.cause ? ` (${String(error.cause)})` : ''}` : String(error);
			}
			if (ready) {break;}
			await delay(400, this.abort.signal);
		}
		if (!ready) {throw new Error(`Metro did not become ready within 90 seconds at http://127.0.0.1:${port}/status. Last check: ${lastStatus}. See the Metro tab.`);}
		this.log('\n[Valdroid] Metro ready.\n');
		return metro;
	}

	private launch(root: string, cli: string, args: string[], label: string) {
		this.abort.signal.throwIfAborted();
		const env: NodeJS.ProcessEnv = {...process.env, ELECTRON_RUN_AS_NODE: '1', FORCE_COLOR: '0'};
		// Piped output already disables Expo's interactive prompts. CI also disables Metro watching.
		delete env.CI;
		delete env.VALDROID_METRO_SESSION;
		delete env.VALDROID_METRO_PID;
		// Expo binds "localhost" using DNS order. ADB reverse and our probe use IPv4.
		const preload = label === 'Metro' && this.reporterPreload ? ['--require', this.reporterPreload] : [];
		if (label === 'Metro' && this.injection) {
			env.VALDROID_METRO_SESSION = this.injection.sessionFile;
			preload.push('--require', this.injection.preload);
		}
		return this.launchCommand(root, process.execPath, ['--dns-result-order=ipv4first', ...preload, cli, ...args], label, env);
	}

	private launchCommand(root: string, executable: string, args: string[], label: string, env: NodeJS.ProcessEnv = {...process.env}) {
		this.abort.signal.throwIfAborted();
		this.log(`\n[${label}] ${path.basename(executable)} ${args.join(' ')}\n`);
		const child = spawn(executable, args, {
			cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
			env,
		});
		this.children.add(child);
		for (const stream of [child.stdout, child.stderr]) {
			const decoder = new StringDecoder('utf8');
			stream?.on('data', data => this.log(decoder.write(data)));
			stream?.on('end', () => {const tail = decoder.end(); if (tail) {this.log(tail);}});
		}
		const done = new Promise<void>((resolve, reject) => {
			child.once('error', error => {this.children.delete(child); this.log(`\n[${label}] ${error.message}\n`); reject(error);});
			child.once('close', (code, signal) => {
				this.children.delete(child);
				this.log(`\n[${label}] exited (${signal ?? code})\n`);
				if (code === 0) {resolve();} else {reject(new Error(`${label} exited (${signal ?? code}). See the Metro tab.`));}
			});
		});
		return {child, done};
	}

	async stop(): Promise<void> {
		this.abort.abort();
		await Promise.all([...this.children].map(async child => {
			if (!child.pid) {return;}
			if (process.platform === 'win32') {
				await runFile('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => undefined);
			} else {
				try {process.kill(-child.pid, 'SIGTERM');} catch {return;}
				await waitForExit(child, 3000);
				try {process.kill(-child.pid, 'SIGKILL');} catch { /* Process group has exited. */ }
			}
		}));
		this.children.clear();
	}
}
