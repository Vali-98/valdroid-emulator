import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { delay, platformTarget, runFile, terminateProcess, waitForExit } from './process';
import { listTargets } from './targets';
import type { EmulatorViewProvider } from '../view/EmulatorViewProvider';
import type { ServerStatus } from '../shared/protocol';
import { AdbFileTransfer } from './AdbFileTransfer';
import type { TransferFile } from './FileUploadReceiver';
import { preferredAgentAddress, preferredHTTPAddress, waitForServerAddress } from './serverConnection';

export class EmulatorSession {
	private serverProcess?: ChildProcess;
	private emulatorProcess?: ChildProcess;
	private emulatorSerial?: string;
	private activeSerial?: string;
	private stoppingEmulator?: Promise<void>;
	private readonly fileTransfer: AdbFileTransfer;

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

	async startTarget(value: string): Promise<void> {
		try {
			const serial = value.startsWith('device:') ? value.slice('device:'.length) : await this.launchAVD(value.slice('avd:'.length));
			const fallbackName = value.startsWith('device:') ? serial : value.slice('avd:'.length);
			const name = await this.deviceName(serial, fallbackName);
			await this.startServer(serial, name);
		} catch (error) {
			await this.stop();
			throw error;
		}
	}

	private async deviceName(serial: string, fallback: string): Promise<string> {
		if (!serial.startsWith('emulator-')) {return fallback;}
		const output = await runFile(this.adbPath, ['-s', serial, 'emu', 'avd', 'name']).catch(() => '');
		return output.split(/\r?\n/).map(line => line.trim()).find(line => line && line !== 'OK') || fallback;
	}

	private async launchAVD(avd: string): Promise<string> {
		const existing = (await listTargets(this.emulatorPath, this.adbPath, this.output)).find(target => target.value.startsWith('device:'));
		if (existing) {return existing.value.slice('device:'.length);}
		this.output.appendLine(`Starting AVD ${avd}`);
		this.emulatorProcess = spawn(this.emulatorPath, ['-avd', avd, '-no-window', '-gpu', 'host'], { stdio: 'ignore' });
		this.emulatorProcess.on('error', error => this.output.appendLine(`Emulator process error: ${error.message}`));
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			const devices = await runFile(this.adbPath, ['devices']).catch(() => '');
			const serial = devices.split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/)).find(([id, state]) => id?.startsWith('emulator-') && state === 'device')?.[0];
			if (serial) {
				const booted = await runFile(this.adbPath, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).catch(() => '');
				if (booted.trim() === '1') {
					this.emulatorSerial = serial;
					return serial;
				}
			}
			await delay(1000);
		}
		throw new Error(`Timed out waiting for AVD ${avd} to finish booting.`);
	}

	private async startServer(serial: string, name: string): Promise<void> {
		if (this.serverProcess && !this.serverProcess.killed) {await this.stopServer();}
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
		], { cwd: bundleDir, stdio: 'pipe' });
		const child = this.serverProcess;
		this.activeSerial = serial;
		child.stdout?.on('data', data => this.output.append(data.toString()));
		child.stderr?.on('data', data => this.output.append(data.toString()));
		child.on('error', error => this.output.appendLine(`Control server process error: ${error.message}`));
		child.on('exit', code => {
			this.output.appendLine(`Control server exited (${code ?? 'signal'}).`);
			if (this.serverProcess === child) {
				this.serverProcess = undefined;
				this.activeSerial = undefined;
				this.onDeviceChanged(undefined);
				this.provider.setServer(undefined);
				void runFile(this.adbPath, ['-s', serial, 'reverse', '--remove', 'localabstract:screen-sharing-agent']).catch(() => undefined);
			}
		});
		this.provider.setStatus('Starting control server and Android agent…', 'online');
		let baseUrl: string;
		try {
			baseUrl = await waitForServerAddress(child);
			await this.waitForAgent(baseUrl, child);
		} catch (error) {
			if (this.serverProcess === child) {await this.stopServer();}
			throw error;
		}
		if (this.serverProcess !== child) {return;}
		this.provider.setServer(baseUrl, name);
		this.onDeviceChanged(serial);
		this.provider.setStatus(`Connected · ${serial}`, 'online');
		this.output.appendLine(`Control server ready at ${baseUrl} for ${serial}`);
	}

	private async waitForAgent(baseUrl: string, processHandle: ChildProcess): Promise<void> {
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			if (processHandle.exitCode !== null || processHandle.signalCode !== null) {throw new Error(`Control server exited (${processHandle.signalCode || processHandle.exitCode}).`);}
			try {
				const response = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
				if (response.ok) {
					const status = await response.json() as ServerStatus;
					if (status.agentError) {throw new Error(status.agentError);}
					if (status.videoConnected && status.controlConnected) {return;}
				}
			} catch (error) {
				if (error instanceof Error && error.message !== 'fetch failed' && error.name !== 'TimeoutError') {throw error;}
			}
			await delay(300);
		}
		throw new Error('Timed out waiting for the Android agent channels. See the Valdroid Emulator output channel.');
	}

	private async stopServer(): Promise<string | undefined> {
		this.provider.setStatus('Stopping Android agent...', 'online');
		const serial = this.activeSerial;
		this.activeSerial = undefined;
		this.onDeviceChanged(undefined);
		const child = this.serverProcess;
		this.serverProcess = undefined;
		if (child) {await terminateProcess(child);}
		if (serial) {
			await runFile(this.adbPath, ['-s', serial, 'reverse', '--remove', 'localabstract:screen-sharing-agent']).catch(error => this.output.appendLine(`Could not remove ADB reverse mapping: ${String(error)}`));
		}
		this.provider.setServer(undefined);
		this.provider.setStatus('Stream server stopped', 'idle');
		return serial;
	}

	async stop(): Promise<void> {
		if (this.stoppingEmulator) {return this.stoppingEmulator;}
		this.stoppingEmulator = (async () => {
			const serial = await this.stopServer();
			const child = this.emulatorProcess;
			const ownedSerial = this.emulatorSerial;
			this.emulatorProcess = undefined;
			this.emulatorSerial = undefined;
			if (child) {
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
}
