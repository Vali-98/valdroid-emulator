import { spawn } from 'node:child_process';
import type * as vscode from 'vscode';
import { isApk, type FileTransferResult } from '../../shared/protocol';
import { runFile } from '../session/process';

export class AdbFileTransfer {
	constructor(
		private readonly adbPath: string,
		private readonly getSerial: () => string | undefined,
		private readonly output: Pick<vscode.OutputChannel, 'appendLine'>,
	) {}

	async send(file: string, name: string, serial: string, signal: AbortSignal, progress: (percent: number) => void): Promise<FileTransferResult> {
		if (signal.aborted) {throw new Error('Upload canceled');}
		if (serial !== this.getSerial()) {throw new Error('The selected Android device is no longer connected');}
		const apk = isApk(name);
		const destination = `/sdcard/Download/${name}`;
		const args = apk ? ['install', '-r', '-t', file] : ['push', file, destination];
		this.output.appendLine(apk ? `Installing ${name} on ${serial}` : `Sending ${name} to ${serial}:${destination}`);
		await new Promise<void>((resolve, reject) => {
			const child = spawn(this.adbPath, ['-s', serial, ...args], { signal, stdio: ['ignore', 'pipe', 'pipe'] });
			let details = '';
			const timer = setTimeout(() => {child.kill(); reject(new Error(apk ? 'ADB installation timed out' : 'ADB file transfer timed out'));}, 15 * 60 * 1000);
			const receive = (data: Buffer) => {
				const text = data.toString();
				details = (details + text).slice(-8192);
				for (const match of text.matchAll(/(\d+)%/g)) {progress(Math.min(99, Number(match[1])));}
			};
			child.stdout.on('data', receive);
			child.stderr.on('data', receive);
			child.once('error', error => {clearTimeout(timer); reject(signal.aborted ? new Error('Upload canceled') : error);});
			child.once('close', code => {
				clearTimeout(timer);
				if (code === 0 && !signal.aborted && (!apk || /^Success\s*$/m.test(details))) {resolve();}
				else {reject(new Error(signal.aborted ? 'Upload canceled' : `ADB ${apk ? 'install' : 'push'} failed: ${details.trim() || `exit ${code}`}`));}
			});
		});
		if (signal.aborted || serial !== this.getSerial()) {throw new Error('Device disconnected during file transfer');}
		if (apk) {
			progress(100);
			this.output.appendLine(`Installed ${name} on ${serial}`);
			return { kind: 'installed' };
		}
		const uri = `file://${destination.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
		await runFile(this.adbPath, ['-s', serial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `'${uri}'`])
			.catch(error => this.output.appendLine(`Could not refresh Downloads: ${String(error)}`));
		progress(100);
		this.output.appendLine(`Sent ${name} to ${destination}`);
		return { kind: 'download', path: destination };
	}
}
