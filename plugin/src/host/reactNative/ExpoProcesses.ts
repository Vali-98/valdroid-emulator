import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { delay, runFile, waitForExit } from '../session/process';

export class ExpoProcesses {
	private readonly children = new Set<ChildProcess>();
	private readonly abort = new AbortController();
	constructor(private readonly log: (text: string) => void, private readonly onProgress: (status: string) => void = () => undefined, private readonly reporterPreload?: string, private readonly injection?: {preload: string; sessionFile: string}) {}

	async start(root: string, cli: string, deviceName: string, port: number, appReady?: Promise<void>): Promise<void> {
		const metro = this.launch(root, cli, ['start', '--localhost', '--port', String(port)], 'Metro');
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
		this.log('\n[Valdroid] Metro ready. Building and installing Android app…\n');
		this.onProgress('Building, installing and launching app…');
		// Expo recognizes the existing project server on this port and reuses it.
		// --no-bundler both conflicts with --port and falls back to port 8081.
		const build = this.launch(root, cli, ['run:android', '--device', deviceName, '--port', String(port)], 'Build');
		let runtimeConnected = false;
		if (appReady) {
			await Promise.race([build.done, appReady.then(() => {runtimeConnected = true;})]);
		} else {await build.done;}
		if (metroError) {throw metroError;}
		if (metro.child.exitCode !== null || metro.child.signalCode !== null) {throw new Error('Metro exited during the Android build. See the Metro tab.');}
		this.log(runtimeConnected ? '\n[Valdroid] App runtime connected. Startup complete; Expo processes remain managed.\n' : '\n[Valdroid] Android build/install complete. Metro remains running.\n');
	}

	private launch(root: string, cli: string, args: string[], label: string) {
		this.abort.signal.throwIfAborted();
		this.log(`\n[${label}] expo ${args.join(' ')}\n`);
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
		const child = spawn(process.execPath, ['--dns-result-order=ipv4first', ...preload, cli, ...args], {
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
