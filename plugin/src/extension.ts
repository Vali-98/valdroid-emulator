import * as vscode from 'vscode';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);
const viewId = 'valdroidEmulator.view';
const httpPort = 8080;
const socketPort = 5050;

interface EmulatorTarget {
	label: string;
	value: string;
}

interface ServerStatus {
	videoConnected: boolean;
	audioConnected: boolean;
	controlConnected: boolean;
	agentStarting: boolean;
	agentStarted: boolean;
	agentError?: string;
}

class EmulatorViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private serverUrl?: string;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly listTargets: () => Promise<EmulatorTarget[]>,
		private readonly startTarget: (value: string) => Promise<void>,
		private readonly stopEmulator: () => Promise<void>,
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
				vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			],
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(async (message: { type?: string; value?: string }) => {
			try {
				switch (message.type) {
					case 'ready':
						await this.refreshTargets();
						this.postStatus();
						break;
					case 'refresh':
						await this.refreshTargets();
						break;
					case 'start':
						if (message.value) {await this.startTarget(message.value);}
						break;
					case 'stop':
						await this.stopEmulator();
						this.setServer(undefined);
						break;
					case 'close':
						await this.stopEmulator();
						this.setServer(undefined);
						break;
				}
			} catch (error) {
				this.setStatus(error instanceof Error ? error.message : String(error), 'error');
			}
		});
	}

	async refreshTargets(): Promise<void> {
		const targets = await this.listTargets();
		this.view?.webview.postMessage({ type: 'targets', targets });
	}

	setServer(serverUrl?: string): void {
		this.serverUrl = serverUrl;
		this.postStatus();
	}

	setStatus(status: string, state: 'idle' | 'online' | 'error'): void {
		this.view?.webview.postMessage({ type: 'status', status, state, serverUrl: this.serverUrl });
	}

	private postStatus(): void {
		this.setStatus(this.serverUrl ? 'Connecting to emulator' : 'Select an emulator', this.serverUrl ? 'online' : 'idle');
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
		const csp = `default-src 'none'; img-src http://127.0.0.1:* data: blob:; connect-src http://127.0.0.1:* ws://127.0.0.1:*; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};`;
		return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel("Valdroid Emulator");
	let serverProcess: ChildProcess | undefined;
	let emulatorProcess: ChildProcess | undefined;
	let activeServerUrl: string | undefined;

	const configuration = vscode.workspace.getConfiguration('valdroid-emulator');
	const adbPath = configuration.get<string>('adbPath', 'adb');
	const configuredEmulatorPath = configuration.get<string>('emulatorPath', '');
	const bitRate = configuration.get<number>('bitRate', 10000000);
	const emulatorPath = configuredEmulatorPath || defaultEmulatorPath();

	const listTargets = async (): Promise<EmulatorTarget[]> => {
		const targets: EmulatorTarget[] = [];
		try {
			const avdOutput = await runFile(emulatorPath, ['-list-avds']);
			for (const avd of avdOutput.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
				targets.push({ label: `AVD · ${avd}`, value: `avd:${avd}` });
			}
		} catch (error) {
			output.appendLine(`Could not list AVDs: ${String(error)}`);
		}
		try {
			const devices = await runFile(adbPath, ['devices']);
			for (const line of devices.split(/\r?\n/).slice(1)) {
				const [serial, state] = line.trim().split(/\s+/);
				if (serial && state === 'device') {targets.push({ label: `Running · ${serial}`, value: `device:${serial}` });}
			}
		} catch (error) {
			output.appendLine(`Could not list ADB devices: ${String(error)}`);
		}
		return targets;
	};

	const provider = new EmulatorViewProvider(
		context,
		listTargets,
		async value => {
			const serial = value.startsWith('device:') ? value.slice('device:'.length) : await launchAVD(value.slice('avd:'.length));
			await startServer(serial);
		},
		async () => stopEmulator(),
	);

	async function launchAVD(avd: string): Promise<string> {        
		const existing = (await listTargets()).find(target => target.value.startsWith('device:'));
		if (existing) {return existing.value.slice('device:'.length);}
		output.appendLine(`Starting AVD ${avd}`);
		emulatorProcess = spawn(emulatorPath, ['-avd', avd, '-no-window', '-gpu', 'host'], { stdio: 'ignore' });
		emulatorProcess.on('error', error => output.appendLine(`Emulator process error: ${error.message}`));
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			const devices = await runFile(adbPath, ['devices']).catch(() => '');
			const serial = devices.split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/)).find(([id, state]) => id?.startsWith('emulator-') && state === 'device')?.[0];
			if (serial) {
				const booted = await runFile(adbPath, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).catch(() => '');
				if (booted.trim() === '1') {return serial;}
			}
			await delay(1000);
		}
		throw new Error(`Timed out waiting for AVD ${avd} to finish booting.`);
	}

	async function startServer(serial: string): Promise<void> {
		if (serverProcess && !serverProcess.killed) {await stopServer();}
		const target = platformTarget();
		const bundleDir = path.join(context.extensionPath, 'bundle', target);
		const serverName = process.platform === 'win32' ? 'control-server.exe' : 'control-server';
		const serverPath = path.join(bundleDir, serverName);
		if (!fs.existsSync(serverPath)) {
			throw new Error(`Missing bundled server for ${target} in ${serverPath}. Build the control-server and package the extension for this platform.`);
		}
		const port = 8080;
		const baseUrl = `http://127.0.0.1:${port}`;
		serverProcess = spawn(serverPath, [
			'--http', `127.0.0.1:${port}`,
			'--socket', '127.0.0.1:5050',
			'--dist-dir', bundleDir,
			'--device-serial', serial,
			'--adb', adbPath,
			'--bit-rate', String(bitRate),
		], { cwd: bundleDir, stdio: 'pipe' });
		serverProcess.stdout?.on('data', data => output.append(data.toString()));
		serverProcess.stderr?.on('data', data => output.append(data.toString()));
		serverProcess.on('exit', code => {
			output.appendLine(`Control server exited (${code ?? 'signal'}).`);
			serverProcess = undefined;
			activeServerUrl = undefined;
			provider.setServer(undefined);
		});
		activeServerUrl = baseUrl;
		provider.setStatus('Starting control server and Android agent…', 'online');
		await waitForAgent(baseUrl, serverProcess);
		provider.setServer(baseUrl);
		provider.setStatus(`Connected · ${serial}`, 'online');
		output.appendLine(`Control server ready at ${baseUrl} for ${serial}`);
	}

	async function waitForAgent(baseUrl: string, processHandle: ChildProcess): Promise<void> {
		const deadline = Date.now() + 60000;
		while (Date.now() < deadline) {
			if (processHandle.exitCode !== null) {throw new Error(`Control server exited with code ${processHandle.exitCode}.`);}
			try {
				const response = await fetch(`${baseUrl}/api/status`);
				if (response.ok) {
					const status = await response.json() as ServerStatus;
					if (status.agentError) {throw new Error(status.agentError);}
					if (status.videoConnected && status.controlConnected) {return;}
				}
			} catch (error) {
				if (error instanceof Error && error.message !== 'fetch failed') {throw error;}
			}
			await delay(300);
		}
		throw new Error('Timed out waiting for the Android agent channels. See the Valdroid Emulator output channel.');
	}

	async function stopServer(): Promise<void> {
		activeServerUrl = undefined;
		provider.setServer(undefined);
		const child = serverProcess;
		serverProcess = undefined;
		if (child && child.exitCode === null) {child.kill();}
		provider.setStatus('Stream server stopped', 'idle');
	}

	async function stopEmulator(): Promise<void> {
		await stopServer();
		const child = emulatorProcess;
		emulatorProcess = undefined;
		if (child && child.exitCode === null) {
			child.kill();
			provider.setStatus('Emulator stopped', 'idle');
		}
	}

	const disposable = vscode.window.registerWebviewViewProvider('valdroidEmulator.view', provider, { webviewOptions: { retainContextWhenHidden: true } });
	context.subscriptions.push(
		output,
		disposable,
		vscode.commands.registerCommand('valdroid-emulator.show', () => vscode.commands.executeCommand('workbench.view.extension.valdroidEmulator')),
		vscode.commands.registerCommand('valdroid-emulator.start', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.valdroidEmulator');
			const targets = await listTargets();
			const chosen = await vscode.window.showQuickPick(targets, { placeHolder: 'Select an Android AVD or connected device' });
			if (chosen) {await provider.refreshTargets().then(() => startServerForTarget(chosen.value));}
		}),
		vscode.commands.registerCommand('valdroid-emulator.stop', () => stopEmulator()),
		{ dispose: () => { void stopEmulator(); } },
	);

	async function startServerForTarget(value: string): Promise<void> {
		const serial = value.startsWith('device:') ? value.slice('device:'.length) : await launchAVD(value.slice('avd:'.length));
		await startServer(serial);
	}
}

export function deactivate(): void {}

function defaultEmulatorPath(): string {
	const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Android', 'sdk') : '');
	return sdk ? path.join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator') : 'emulator';
}

function platformTarget(): string {
	const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
	return `${platform}-${process.arch}`;
}

function runFile(file: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { encoding: 'utf8', timeout: 15000 }, (error, stdout, stderr) => {
			if (error) {reject(new Error(`${path.basename(file)} failed: ${stderr.trim() || error.message}`));}
			else {resolve(stdout);}
		});
	});
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}
