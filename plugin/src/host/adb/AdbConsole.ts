import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { runFile, terminateProcess } from '../session/process';
import { adbArguments } from './adbCommand';
import { consoleLimit, parseLogcat, parseProcesses, type ConsoleMessage, type ConsoleRecord, type ConsoleState } from '../../shared/console';

export class AdbConsole {
	private records: ConsoleRecord[] = [];
	private pending: ConsoleRecord[] = [];
	private id = 0;
	private generation = 0;
	private logcat?: ChildProcess;
	private command?: ChildProcess;
	private processTimer?: ReturnType<typeof setInterval>;
	private batchTimer?: ReturnType<typeof setTimeout>;
	private refreshing = false;
	private disposed = false;
	private state: ConsoleState = { streaming: false, busy: false, packages: [], processes: {} };

	constructor(private readonly adbPath: string, private readonly emit: (message: ConsoleMessage) => void) {}

	snapshot(): ConsoleMessage { return { type: 'console-snapshot', state: this.state, records: this.records }; }
	get serial(): string | undefined { return this.state.serial; }
	private postState(): void { if (!this.disposed) { this.emit({ type: 'console-state', state: this.state }); } }
	private append(record: ConsoleRecord): void {
		if (this.disposed) { return; }
		this.records.push(record);
		if (this.records.length > consoleLimit) { this.records.splice(0, this.records.length-consoleLimit); }
		this.pending.push(record);
		if (this.pending.length > consoleLimit) { this.pending.splice(0, this.pending.length-consoleLimit); }
		this.batchTimer ??= setTimeout(() => {
			this.batchTimer = undefined;
			this.emit({ type: 'console-records', records: this.pending });
			this.pending = [];
		}, 100);
	}
	notice(text: string, error = false): void {
		this.append({ id: ++this.id, kind: error ? 'error' : 'notice', level: error ? 'E' : 'I', time: '', text });
	}
	clear(): void {
		clearTimeout(this.batchTimer); this.batchTimer = undefined;
		this.pending = []; this.records = [];
		this.emit(this.snapshot());
	}
	async selectDevice(serial?: string): Promise<void> {
		if (this.disposed) { return; }
		const generation = ++this.generation;
		clearInterval(this.processTimer); this.processTimer = undefined;
		const old = this.logcat; this.logcat = undefined;
		const command = this.command; this.command = undefined;
		const previousSerial = this.state.serial;
		this.state = { serial, streaming: false, busy: false, packages: [], processes: {} };
		if (serial) { this.clear(); }
		else { this.postState(); if (previousSerial) { this.notice(`Disconnected from ${previousSerial}`); } }
		await Promise.all([old && terminateProcess(old), command && terminateProcess(command)]);
		if (!serial || this.disposed || generation !== this.generation) { return; }
		try {
			const [packages, processes] = await Promise.all([
				runFile(this.adbPath, ['-s', serial, 'shell', 'pm', 'list', 'packages']),
				runFile(this.adbPath, ['-s', serial, 'shell', 'ps', '-A', '-o', 'PID,NAME']),
			]);
			if (generation !== this.generation || this.disposed) { return; }
			this.state = { ...this.state, packages: packages.split(/\r?\n/).filter(line => line.startsWith('package:')).map(line => line.slice(8).trim()).sort(), processes: parseProcesses(processes) };
		} catch (error) {
			if (generation !== this.generation || this.disposed) { return; }
			this.notice(`Package discovery: ${String(error)}`, true);
		}
		this.startLogcat();
		this.processTimer = setInterval(() => { void this.refreshProcesses(generation, serial); }, 5000);
	}
	private async refreshProcesses(generation: number, serial: string): Promise<void> {
		if (this.refreshing || this.disposed) { return; }
		this.refreshing = true;
		try {
			const text = await runFile(this.adbPath, ['-s', serial, 'shell', 'ps', '-A', '-o', 'PID,NAME']);
			if (generation === this.generation && !this.disposed) { this.state = { ...this.state, processes: parseProcesses(text) }; this.postState(); }
		} catch { /* A disconnected logcat reports the device error. */ }
		finally { this.refreshing = false; }
	}
	private stream(child: ChildProcess, receive: (line: string, error: boolean) => void): void {
		for (const [stream, error] of [[child.stdout, false], [child.stderr, true]] as const) {
			if (!stream) { continue; }
			const lines = createInterface({ input: stream, crlfDelay: Infinity });
			lines.on('line', line => receive(line.slice(0, 16384), error));
			child.once('close', () => lines.close());
		}
	}
	private startLogcat(): void {
		if (!this.state.serial || this.logcat || this.disposed) { return; }
		const child = spawn(this.adbPath, ['-s', this.state.serial, 'logcat', '-v', 'threadtime', '-T', '200', '*:V'], { stdio: ['ignore', 'pipe', 'pipe'] });
		this.logcat = child;
		this.state = { ...this.state, streaming: true }; this.postState();
		this.stream(child, (line, error) => {
			if (this.logcat !== child) { return; }
			if (error) { this.notice(line, true); }
			else { this.append(parseLogcat(line, ++this.id, this.state.processes)); }
		});
		child.once('error', error => { if (this.logcat === child) { this.notice(error.message, true); } });
		child.once('close', code => {
			if (this.logcat !== child) { return; }
			this.logcat = undefined; this.state = { ...this.state, streaming: false }; this.postState();
			this.notice(`Logcat stopped (${code ?? 'signal'})`, code !== 0);
		});
	}
	async toggle(): Promise<void> {
		if (!this.logcat) { this.startLogcat(); return; }
		const child = this.logcat; this.logcat = undefined;
		this.state = { ...this.state, streaming: false }; this.postState();
		await terminateProcess(child);
	}
	async execute(command: string): Promise<void> {
		if (this.disposed) { return; }
		try {
			if (!this.state.serial) { throw new Error('No Android device selected'); }
			if (this.command) { throw new Error('An ADB command is already running'); }
			const args = adbArguments(command);
			this.append({ id: ++this.id, kind: 'command', level: 'I', time: '', text: `adb ${command.replace(/^adb\s+/, '')}` });
			const child = spawn(this.adbPath, ['-s', this.state.serial, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
			this.command = child; this.state = { ...this.state, busy: true }; this.postState();
			this.stream(child, (text, error) => {
				if (this.command === child) { this.append({ id: ++this.id, kind: error ? 'error' : 'output', level: error ? 'E' : 'I', time: '', text }); }
			});
			const timer = setTimeout(() => { if (this.command === child) { this.notice('ADB command timed out', true); void this.cancelCommand(); } }, 5*60*1000);
			child.once('error', error => { if (this.command === child) { this.notice(error.message, true); } });
			child.once('close', code => {
				clearTimeout(timer);
				if (this.command !== child) { return; }
				this.command = undefined; this.state = { ...this.state, busy: false }; this.postState();
				this.notice(`Exit ${code ?? 'signal'}`, code !== 0);
			});
		} catch (error) { this.notice(error instanceof Error ? error.message : String(error), true); }
	}
	async cancelCommand(): Promise<void> {
		const child = this.command; this.command = undefined;
		this.state = { ...this.state, busy: false }; this.postState();
		if (child) { await terminateProcess(child); this.notice('Command canceled'); }
	}
	async dispose(): Promise<void> {
		this.disposed = true; ++this.generation;
		clearInterval(this.processTimer); clearTimeout(this.batchTimer);
		const children = [this.command, this.logcat]; this.command = undefined; this.logcat = undefined;
		await Promise.all(children.map(child => child && terminateProcess(child)));
	}
}
