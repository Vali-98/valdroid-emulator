import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { ReactScanIntegration, type ReactScanProject } from './ReactScanIntegration';
import { runFile } from '../session/process';
import { ExpoProcesses } from './ExpoProcesses';
import { resolveExpoDeviceName } from './expoDevice';
import { parseScanOutlines, type ScanOutlines } from '../../shared/scan';
import {parseJSLogs, type JSLog} from '../../shared/jsConsole';

export class ExpoSession {
	private processes?: ExpoProcesses;
	private server?: http.Server;
	private project?: ReactScanProject;
	private serial?: string;
	private port?: number;
	private enabled = false;
	private connectedAt = 0;
	private stopping?: Promise<void>;
	constructor(private readonly extensionPath: string, private readonly adbPath: string, private readonly log: (text: string) => void = () => undefined, private readonly onOutlines: (batch: ScanOutlines) => void = () => undefined, private readonly onProgress: (status: string) => void = () => undefined, private readonly onJSLogs: (records: Omit<JSLog, 'id'>[]) => void = () => undefined) {}

	async start(root: string, serial: string): Promise<void> {
		await this.stop();
		this.log(`\n[Valdroid] Starting Expo project: ${root}\n`);
		const project = await ReactScanIntegration.inspect(root);
		const deviceName = await resolveExpoDeviceName(this.adbPath, serial);
		this.log(`[Valdroid] Expo target: ${deviceName} (ADB: ${serial})\n`);
		await fs.access(path.join(root, 'node_modules', 'expo', 'bin', 'cli')).catch(() => {throw new Error('Install this Expo project’s dependencies before starting it in Valdroid.');});
		const token = randomBytes(24).toString('hex');
		let signalAppReady!: () => void;
		const appReady = new Promise<void>(resolve => {signalAppReady = resolve;});
		const server = http.createServer((request, response) => {
			if (request.url !== `/${token}`) {response.writeHead(404).end(); return;}
			if (request.method === 'POST') {
				let size = 0;
				const chunks: Buffer[] = [];
				request.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size > 2 * 1024 * 1024) {response.writeHead(413).end(); request.destroy(); return;}
					chunks.push(chunk);
				});
				request.on('end', () => {
					if (response.writableEnded) {return;}
					try {
						const event: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
						const records = parseJSLogs(event);
						if (records) {this.onJSLogs(records); response.writeHead(204).end(); return;}
						const batch = parseScanOutlines(event);
						if (!batch) {response.writeHead(400).end(); return;}
						if (this.enabled) {this.onOutlines(batch);}
						response.writeHead(204).end();
					} catch {response.writeHead(400).end();}
				});
				request.on('error', () => {if (!response.writableEnded) {response.end();}});
				return;
			}
			if (request.method !== 'GET') {response.writeHead(405).end(); return;}
			this.connectedAt = Date.now();
			signalAppReady();
			response.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
			response.end(JSON.stringify({enabled: this.enabled}));
		});
		await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
		this.server = server;
		const address = server.address();
		if (!address || typeof address === 'string') {throw new Error('Could not allocate Scan control port.');}
		this.port = address.port; this.serial = serial;
		try {
			await runFile(this.adbPath, ['-s', serial, 'reverse', `tcp:${this.port}`, `tcp:${this.port}`]);
			await ReactScanIntegration.enable(project, path.join(this.extensionPath, 'dist', 'react-scan-runtime.js'), `http://127.0.0.1:${this.port}/${token}`);
			this.project = await ReactScanIntegration.inspect(root);
			const reservation = http.createServer();
			await new Promise<void>((resolve, reject) => {reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve);});
			const metroAddress = reservation.address();
			if (!metroAddress || typeof metroAddress === 'string') {throw new Error('Could not allocate Metro port.');}
			const metroPort = metroAddress.port;
			await new Promise<void>(resolve => reservation.close(() => resolve()));
			await runFile(this.adbPath, ['-s', serial, 'reverse', `tcp:${metroPort}`, `tcp:${metroPort}`]);
			this.metroPort = metroPort;
			this.processes = new ExpoProcesses(this.log, this.onProgress, path.join(this.extensionPath, 'dist', 'expo-reporter.cjs'));
			await this.processes.start(root, path.join(root, 'node_modules', 'expo', 'bin', 'cli'), deviceName, metroPort, appReady);
		} catch (error) {this.log(`\n[Valdroid] Expo startup failed: ${String(error)}\n`); await this.stop(); throw error;}
	}

	setScan(enabled: boolean): void {
		if (!this.project) {throw new Error('Start an Expo session first.');}
		this.enabled = enabled;
	}
	get state() {return {active: Boolean(this.project), enabled: this.enabled, connected: Date.now() - this.connectedAt < 4000};}

	stop(): Promise<void> {
		if (this.stopping) {return this.stopping;}
		const stopping = this.stopResources();
		this.stopping = stopping;
		return stopping.finally(() => {if (this.stopping === stopping) {this.stopping = undefined;}});
	}

	private async stopResources(): Promise<void> {
		await this.processes?.stop(); this.processes = undefined;
		this.enabled = false; this.connectedAt = 0;
		if (this.server) {this.server.closeAllConnections(); await new Promise<void>(resolve => this.server!.close(() => resolve())); this.server = undefined;}
		if (this.serial && this.port) {await runFile(this.adbPath, ['-s', this.serial, 'reverse', '--remove', `tcp:${this.port}`]).catch(() => undefined);}
		if (this.serial && this.metroPort) {await runFile(this.adbPath, ['-s', this.serial, 'reverse', '--remove', `tcp:${this.metroPort}`]).catch(() => undefined);}
		this.metroPort = undefined;
		this.serial = undefined; this.port = undefined;
		if (this.project) {const project = this.project; this.project = undefined; await ReactScanIntegration.disable(await ReactScanIntegration.inspect(project.root));}
	}
	private metroPort?: number;
}
