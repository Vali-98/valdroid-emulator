import * as vscode from 'vscode';
import {execFile, spawn, type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runFile} from '../session/process';
import {type DeviceToolAction, type DeviceToolsState} from '../../shared/deviceTools';

interface Recording {serial: string; remote: string; pidFile: string; child: ChildProcess; done: Promise<{code: number | null; error: string}>; startedAt: number; finishing?: Promise<void>;}
const exec = promisify(execFile);
export class DeviceTools {
	private recording?: Recording;
	private busy = false;
	private settings: Partial<DeviceToolsState> = {};
	private settingsSerial?: string;
	constructor(private readonly adb: string, private readonly device: () => string | undefined, private readonly changed: () => void, private readonly error: (text: string) => void) {}
	get state(): DeviceToolsState {return {type: 'device-tools-state', ...this.settings, busy: this.busy, recordingStartedAt: this.recording?.startedAt};}
	async action(command: DeviceToolAction): Promise<void> {
		if (this.busy) {return;}
		const serial = command.action === 'record-stop' ? this.recording?.serial ?? this.device() : this.device();
		if (!serial) {throw new Error('Connect a device first.');}
		if (serial !== this.settingsSerial) {this.settingsSerial = serial; this.settings = {};}
		this.busy = true; this.changed();
		const shell = (args: string[]) => runFile(this.adb, ['-s', serial, 'shell', ...args]);
		try {
			switch (command.action) {
				case 'settings': {
					const [night, font] = await Promise.all([shell(['cmd', 'uimode', 'night']), shell(['settings', 'get', 'system', 'font_scale'])]);
					this.settings = {darkMode: /\byes\b/i.test(night), fontScale: Number(font.trim()) || 1};
					break;
				}
				case 'dark-mode': if (typeof command.value !== 'boolean') {throw new Error('Invalid dark mode.');} await shell(['cmd', 'uimode', 'night', command.value ? 'yes' : 'no']); this.settings.darkMode = command.value; break;
				case 'font-scale': if (!Number.isFinite(command.value) || command.value < 0.85 || command.value > 2) {throw new Error('Text size must be between 85% and 200%.');} await shell(['settings', 'put', 'system', 'font_scale', String(command.value)]); this.settings.fontScale = command.value; break;
				case 'screenshot': {
					const {stdout} = await exec(this.adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30000, windowsHide: true});
					if (!stdout.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {throw new Error('Device did not return a PNG screenshot.');}
					const destination = await this.saveDialog('png'); if (destination) {await vscode.workspace.fs.writeFile(destination, stdout);} break;
				}
				case 'record-start': this.startRecording(serial); break;
				case 'record-stop': await this.stopRecording(); break;
				default: throw new Error('Unknown device action.');
			}
		} finally {this.busy = false; this.changed();}
	}
	private saveDialog(extension: 'png' | 'mp4') {return vscode.window.showSaveDialog({title: extension === 'png' ? 'Save screenshot' : 'Save recording', defaultUri: vscode.Uri.file(path.join(os.homedir(), `valdroid-${Date.now()}.${extension}`)), filters: extension === 'png' ? {'PNG image': ['png']} : {'MP4 video': ['mp4']}});}
	private startRecording(serial: string): void {
		if (this.recording) {throw new Error('A recording is already running.');}
		const remote = `/data/local/tmp/valdroid-${randomUUID()}.mp4`, pidFile = `${remote}.pid`;
		const child = spawn(this.adb, ['-s', serial, 'shell', `screenrecord --time-limit 180 ${remote} & pid=$!; echo "$pid" > ${pidFile}; wait "$pid"`], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
		let error = '';
		child.stderr?.on('data', chunk => {error = (error + chunk.toString()).slice(-4000);});
		const done = new Promise<{code: number | null; error: string}>(resolve => {child.once('error', failure => resolve({code: -1, error: failure.message})); child.once('close', code => resolve({code, error}));});
		const recording = this.recording = {serial, remote, pidFile, child, done, startedAt: Date.now()};
		void done.then(() => this.finishRecording(recording)).catch(failure => this.error(String(failure)));
	}
	async stopRecording(): Promise<void> {
		const recording = this.recording; if (!recording) {return;}
		// Match both a numeric PID and our unique output path before signaling.
		if (recording.child.exitCode === null && recording.child.signalCode === null) {
			await runFile(this.adb, ['-s', recording.serial, 'shell', `for attempt in 1 2 3 4 5 6 7 8 9 10; do test -s ${recording.pidFile} && break; sleep 0.1; done; pid=$(cat ${recording.pidFile} 2>/dev/null); case "$pid" in ''|*[!0-9]*) exit 1;; esac; case "$(tr '\\000' ' ' < /proc/$pid/cmdline 2>/dev/null)" in *${recording.remote}*) kill -2 "$pid";; *) exit 1;; esac`], {timeout: 5000});
		}
		await this.finishRecording(recording);
	}
	private finishRecording(recording: Recording): Promise<void> {
		if (recording.finishing) {return recording.finishing;}
		recording.finishing = (async () => {
			let directory: string | undefined;
			let copied = false, completed = false;
			try {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const result = await Promise.race([recording.done, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(new Error('Device recorder did not stop.')), 10000);})]).finally(() => clearTimeout(timer));
				if (this.recording === recording) {this.recording = undefined; this.changed();}
				if (result.code !== 0 && result.code !== 130) {throw new Error(`Screen recording failed: ${result.error || result.code}`);}
				directory = await fs.mkdtemp(path.join(os.tmpdir(), 'valdroid-recording-'));
				const local = path.join(directory, 'recording.mp4');
				await runFile(this.adb, ['-s', recording.serial, 'pull', recording.remote, local], {timeout: 60000});
				if (!(await fs.stat(local)).size) {throw new Error('Device returned an empty recording.');}
				copied = true;
				const destination = await this.saveDialog('mp4');
				if (destination) {await vscode.workspace.fs.copy(vscode.Uri.file(local), destination, {overwrite: true});}
				completed = true;
			} finally {
				if (this.recording === recording) {this.recording = undefined; this.changed();}
				recording.child.kill();
				if (copied) {await runFile(this.adb, ['-s', recording.serial, 'shell', 'rm', '-f', recording.remote, recording.pidFile], {timeout: 5000}).catch(() => undefined);}
				if (directory && completed) {await fs.rm(directory, {recursive: true, force: true});}
				if (!completed) {this.error(`Recording recovery copy: ${copied && directory ? path.join(directory, 'recording.mp4') : `${recording.serial}:${recording.remote}`}`);}
			}
		})();
		return recording.finishing;
	}
}
