import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { delay, platformTarget, runFile, terminateProcess, waitForExit } from './process';
import { listRunningDevices } from '../adb/targets';
import type { EmulatorViewProvider } from '../views/EmulatorViewProvider';
import type { ServerStatus } from '../../shared/protocol';
import { AdbFileTransfer } from '../files/AdbFileTransfer';
import type { TransferFile } from '../files/FileUploadReceiver';
import { preferredAgentAddress, preferredHTTPAddress, waitForServerAddress } from './serverConnection';
import { monitorSession } from './monitorSession';

export class EmulatorSession {
	private serverProcess?: ChildProcess;
	private emulatorProcess?: ChildProcess;
	private emulatorSerial?: string;
	private activeSerial?: string;
	private reconnectSerial?: string;
	private stoppingEmulator?: Promise<void>;
	private readonly fileTransfer: AdbFileTransfer;
	private startup?: AbortController;
	private stopMonitoring?: () => void;
	private disconnecting?: Promise<void>;

	constructor(
		private readonly extensionPath: string,
		private readonly adbPath: string,
		private readonly emulatorPath: string,
		private readonly bitRate: number,
		private readonly output: vscode.OutputChannel,
		private readonly provider: EmulatorViewProvider,
		private readonly onDeviceChanged: (serial?: string) => void = () => undefined,
	) {this.fileTransfer = new AdbFileTransfer(adbPath, () => this.activeSerial, output);}

	get deviceSerial(): string | undefined {return this.activeSerial;}

	transferFile: TransferFile = (...args) => this.fileTransfer.send(...args);

	async reconnect(): Promise<void> {
		if (this.disconnecting) {await this.disconnecting;}
		if (this.startup || this.stoppingEmulator) {throw new Error('Wait for the current device operation to finish.');}
		const serial = this.activeSerial ?? this.reconnectSerial;
		if (!serial) {throw new Error('Connect a device before reconnecting its streams.');}
		const startup = new AbortController(); this.startup = startup;
		try {
			this.provider.setLaunchProgress('Reconnecting device…');
			this.output.appendLine(`Restarting control server and screen-sharing agent for ${serial}`);
			// Stop only the stream server/agent: retain emulator ownership, the app,
			// Metro and their independent reverse mappings.
			await this.stopServer(false);
			startup.signal.throwIfAborted();
			const state = await runFile(this.adbPath, ['-s', serial, 'get-state'], {signal: startup.signal, timeout: 5000});
			if (state.trim() !== 'device') {throw new Error(`Device ${serial} is not available over ADB.`);}
			const name = await this.deviceName(serial, serial, startup.signal);
			await this.startServer(serial, name, startup.signal);
		} catch (error) {
			if (startup.signal.aborted) {return;}
			await this.stopServer(false);
			throw error;
		} finally {if (this.startup === startup) {this.startup = undefined;}}
	}

	async startTarget(value: string): Promise<void> {
		if (this.disconnecting) {await this.disconnecting;}
		this.startup?.abort();
		const startup = new AbortController(); this.startup = startup;
		try {
			const serial = value.startsWith('device:') ? value.slice('device:'.length) : await this.launchAVD(value.slice('avd:'.length), startup.signal);
			startup.signal.throwIfAborted();
			const fallbackName = value.startsWith('device:') ? serial : value.slice('avd:'.length);
			const name = await this.deviceName(serial, fallbackName, startup.signal);
			startup.signal.throwIfAborted();
			await this.startServer(serial, name, startup.signal);
		} catch (error) {
			if (startup.signal.aborted) {return;}
			await this.stop();
			throw error;
		} finally {if (this.startup === startup) {this.startup = undefined;}}
	}

	private async deviceName(serial: string, fallback: string, signal: AbortSignal): Promise<string> {
		if (!serial.startsWith('emulator-')) {return fallback;}
		const output = await runFile(this.adbPath, ['-s', serial, 'emu', 'avd', 'name'], {signal}).catch(() => '');
		return output.split(/\r?\n/).map(line => line.trim()).find(line => line && line !== 'OK') || fallback;
	}

	private async launchAVD(avd: string, signal: AbortSignal): Promise<string> {
		const existing = (await listRunningDevices(this.adbPath, signal)).find(device => device.avdName === avd);
		if (existing) {return existing.serial;}
		signal.throwIfAborted();
		this.output.appendLine(`Starting AVD ${avd}`);
		this.emulatorProcess = spawn(this.emulatorPath, ['-avd', avd, '-no-window', '-gpu', 'host'], { stdio: 'ignore', windowsHide: true });
		const child = this.emulatorProcess;
		let launchError: Error | undefined;
		child.on('error', error => {launchError = error; this.output.appendLine(`Emulator process error: ${error.message}`);});
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			signal.throwIfAborted();
			if (launchError) {throw launchError;}
			if (child.exitCode !== null || child.signalCode !== null) {throw new Error(`Emulator exited while starting ${avd} (${child.signalCode ?? child.exitCode}).`);}
			const devices = await listRunningDevices(this.adbPath, signal).catch(() => []);
			const serial = devices.find(device => device.avdName === avd)?.serial;
			if (serial) {
				const booted = await runFile(this.adbPath, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {signal}).catch(() => '');
				if (booted.trim() === '1') {
					this.emulatorSerial = serial;
					return serial;
				}
			}
			await delay(1000, signal);
		}
		throw new Error(`Timed out waiting for AVD ${avd} to finish booting.`);
	}

	private async startServer(serial: string, name: string, signal: AbortSignal): Promise<void> {
		if (this.serverProcess && !this.serverProcess.killed) {await this.stopServer();}
		signal.throwIfAborted();
		const target = platformTarget();
		const bundleDir = path.join(this.extensionPath, 'bundle', target);
		const serverName = process.platform === 'win32' ? 'control-server.exe' : 'control-server';
		const serverPath = path.join(bundleDir, serverName);
		if (!fs.existsSync(serverPath)) {
			throw new Error(`Missing bundled server for ${target} in ${serverPath}. Build the control-server and package the extension for this platform.`);
		}
		this.serverProcess = spawn(serverPath, [
			'--http', preferredHTTPAddress,
			'--socket', preferredAgentAddress,
			'--auto-port', '--announce-listeners',
			'--dist-dir', bundleDir,
			'--device-serial', serial,
			'--adb', this.adbPath,
			'--bit-rate', String(this.bitRate),
		], { cwd: bundleDir, stdio: 'pipe', windowsHide: true });
		const child = this.serverProcess;
		let connected = false;
		this.activeSerial = serial;
		this.reconnectSerial = serial;
		child.stdout?.on('data', data => this.output.append(data.toString()));
		child.stderr?.on('data', data => this.output.append(data.toString()));
		child.on('error', error => this.output.appendLine(`Control server process error: ${error.message}`));
		child.on('exit', code => {
			this.output.appendLine(`Control server exited (${code ?? 'signal'}).`);
			if (this.serverProcess === child) {
				if (connected) {void this.disconnect(`Control server exited (${code ?? 'signal'}).`).catch(error => this.output.appendLine(`Disconnect cleanup failed: ${String(error)}`)); return;}
				// Startup's error handler owns cleanup until the session is connected.
			}
		});
		this.provider.setStatus('Starting control server and Android agent…', 'online');
		let baseUrl: string;
		try {
			baseUrl = await waitForServerAddress(child, 15000, signal);
			await this.waitForAgent(baseUrl, child, signal);
		} catch (error) {
			if (this.serverProcess === child) {await this.stopServer();}
			throw error;
		}
		if (this.serverProcess !== child) {return;}
		signal.throwIfAborted(); connected = true;
		this.provider.setServer(baseUrl, name);
		this.onDeviceChanged(serial);
		this.provider.setStatus(`Connected · ${serial}`, 'online');
		this.output.appendLine(`Control server ready at ${baseUrl} for ${serial}`);
		this.stopMonitoring = monitorSession(this.adbPath, serial, baseUrl, reason => {
			if (this.serverProcess === child) {void this.disconnect(reason).catch(error => this.output.appendLine(`Disconnect cleanup failed: ${String(error)}`));}
		});
	}

	private async waitForAgent(baseUrl: string, processHandle: ChildProcess, signal: AbortSignal): Promise<void> {
		const deadline = Date.now() + 120000;
		let nextDeviceCheck = 0;
		let deviceFailures = 0;
		while (Date.now() < deadline) {
			signal.throwIfAborted();
			if (processHandle.exitCode !== null || processHandle.signalCode !== null) {throw new Error(`Control server exited (${processHandle.signalCode || processHandle.exitCode}).`);}
			try {
				const response = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) });
				if (response.ok) {
					const status = await response.json() as ServerStatus;
					if (status.agentError) {throw new Error(status.agentError);}
					if (status.videoConnected && status.controlConnected) {return;}
				}
			} catch (error) {
				if (error instanceof Error && error.message !== 'fetch failed' && error.name !== 'TimeoutError') {throw error;}
			}
			if (this.activeSerial && Date.now() >= nextDeviceCheck) {
				const state = await runFile(this.adbPath, ['-s', this.activeSerial, 'get-state'], {signal, timeout: 3000}).catch(() => '');
				signal.throwIfAborted();
				deviceFailures = state.trim() === 'device' ? 0 : deviceFailures + 1;
				if (deviceFailures >= 2) {throw new Error(`Device ${this.activeSerial} disconnected while initializing.`);}
				nextDeviceCheck = Date.now() + 2000;
			}
			await delay(300, signal);
		}
		throw new Error('Timed out waiting for the Android agent channels. See the Valdroid Emulator output channel.');
	}

	private async stopServer(showProgress = true): Promise<string | undefined> {
		this.stopMonitoring?.(); this.stopMonitoring = undefined;
		this.provider.setServer(undefined);
		if (showProgress) {this.provider.setStatus('Stopping Android agent...', 'online');}
		const serial = this.activeSerial;
		this.activeSerial = undefined;
		this.onDeviceChanged(undefined);
		const child = this.serverProcess;
		this.serverProcess = undefined;
		if (child) {await terminateProcess(child);}
		if (serial) {
			await this.removeAgent(serial);
			await runFile(this.adbPath, ['-s', serial, 'reverse', '--remove', 'localabstract:screen-sharing-agent']).catch(error => this.output.appendLine(`Could not remove ADB reverse mapping: ${String(error)}`));
		}
		this.provider.setServer(undefined);
		this.provider.setStatus('Stream server stopped', 'idle');
		return serial;
	}

	private async removeAgent(serial: string): Promise<void> {
		// A stale PID file must never cause an unrelated process to be killed.
		const command = [
			'pid=$(cat /data/local/tmp/.studio/agent.pid 2>/dev/null)',
			'case "$pid" in ""|*[!0-9]*) ;; *) case "$(tr \'\\000\' \' \' < /proc/$pid/cmdline 2>/dev/null)" in *com.android.tools.screensharing.Main*) kill "$pid" 2>/dev/null ;; esac ;; esac',
			'rm -f /data/local/tmp/screen-sharing-agent.jar /data/local/tmp/.studio/libscreen-sharing-agent.so /data/local/tmp/.studio/agent.pid /data/local/tmp/.studio/agent.log',
		].join('; ');
		await runFile(this.adbPath, ['-s', serial, 'shell', command], {timeout: 5000})
			.catch(error => this.output.appendLine(`Could not remove Android screen-sharing agent: ${String(error)}`));
	}

	async stop(): Promise<void> {
		this.startup?.abort();
		this.reconnectSerial = undefined;
		if (this.stoppingEmulator) {return this.stoppingEmulator;}
		this.stoppingEmulator = (async () => {
			const serial = await this.stopServer();
			const child = this.emulatorProcess;
			const ownedSerial = this.emulatorSerial;
			this.emulatorProcess = undefined;
			this.emulatorSerial = undefined;
			if (child && child.exitCode === null && child.signalCode === null) {
				const shutdownSerial = ownedSerial ?? serial;
				if (shutdownSerial?.startsWith('emulator-')) {
					await runFile(this.adbPath, ['-s', shutdownSerial, 'emu', 'kill']).catch(error => this.output.appendLine(`Could not request emulator shutdown: ${String(error)}`));
				}
				await waitForExit(child, 5000);
				if (child.exitCode === null && child.signalCode === null) {await terminateProcess(child);}
				this.provider.setStatus('Emulator stopped', 'idle');
			}
		})();
		try {await this.stoppingEmulator;} finally {this.stoppingEmulator = undefined;}
	}

	async disconnect(reason: string): Promise<void> {
		if (this.disconnecting) {return this.disconnecting;}
		this.provider.setServer(undefined);
		this.provider.notify(reason, 'error');
		this.disconnecting = (async () => {
			await this.stopServer(false);
			await this.provider.refreshTargets().catch(error => this.output.appendLine(`Device refresh failed: ${String(error)}`));
		})();
		try {await this.disconnecting;} finally {this.disconnecting = undefined;}
	}
}
