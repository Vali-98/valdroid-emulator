import * as vscode from 'vscode';
import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {hermesDebugConfiguration, parseHermesTargets} from './hermesTarget';
import {createInspectorTransport} from './InspectorTransport';
import type {DebuggerAction, DebuggerState} from '../../shared/protocol';

export interface DebugApp {root: string; port: number; applicationId: string; serial: string;}
export class HermesDebugger implements vscode.Disposable {
	private session?: vscode.DebugSession;
	private pausedSession?: vscode.DebugSession;
	private transport?: Awaited<ReturnType<typeof createInspectorTransport>>;
	private token?: string;
	private readonly issuedTokens = new Set<string>();
	private threadId?: number;
	private busy = false;
	private paused = false;
	private readonly subscriptions: vscode.Disposable[];
	constructor(private readonly app: () => Promise<DebugApp>, private readonly log: (message: string) => void, private readonly onState: () => void = () => undefined, private readonly traceDirectory?: string) {
		this.subscriptions = [
			vscode.debug.onDidStartDebugSession(session => {
				if (this.owns(session)) {this.session ??= session; this.onState();}
				else if (this.issuedTokens.has(session.configuration.__valdroidDebug)) {void vscode.debug.stopDebugging(session).then(undefined, error => this.log(`[Valdroid] Debugger cleanup: ${String(error)}\n`));}
			}),
			vscode.debug.onDidTerminateDebugSession(session => {
				this.issuedTokens.delete(session.configuration.__valdroidDebug);
				if (this.owns(session) && session === this.session) {this.transport?.close(); this.transport = undefined; this.session = undefined; this.pausedSession = undefined; this.threadId = undefined; this.paused = false; this.token = undefined; this.onState();}
				else if (session === this.pausedSession) {this.pausedSession = undefined; this.threadId = undefined; this.paused = false; this.onState();}
			}),
			vscode.debug.registerDebugAdapterTrackerFactory('*', {createDebugAdapterTracker: session => {
				if (!this.owns(session)) {return;}
				const requests = new Map<number, string>();
				const reported = new Set<string>();
				return {onWillReceiveMessage: message => {
					if (message.type === 'request' && message.command === 'setBreakpoints') {
						if (requests.size >= 100) {requests.delete(requests.keys().next().value!);}
						requests.set(message.seq, String(message.arguments?.source?.path ?? '<unknown source>'));
					}
				}, onDidSendMessage: message => {
					if (!this.owns(session)) {return;}
					if (message.type === 'response' && message.command === 'setBreakpoints') {
						const source = requests.get(message.request_seq) ?? '<unknown source>'; requests.delete(message.request_seq);
						const failures = !message.success ? [message.message ?? 'Request failed'] : (message.body?.breakpoints ?? []).filter((item: {verified?: boolean}) => !item.verified).map((item: {line?: number; message?: string}) => `line ${item.line ?? '?'}: ${item.message ?? 'No matching loaded script/source map'}`);
						const detail = `${source}: ${failures.join('; ')}`;
						if (failures.length && !reported.has(detail)) {if (reported.size >= 100) {reported.clear();} reported.add(detail); this.log(`[Valdroid] Unbound breakpoint — ${detail}\n`);}
						return;
					}
					if (message.type !== 'event') {return;}
					if (message.event === 'breakpoint' && message.body?.breakpoint?.verified) {this.log('[Valdroid] Breakpoint verified by the runtime.\n');}
					if (message.event === 'stopped') {this.pausedSession = session; this.paused = true; this.threadId = message.body?.threadId; this.onState();}
					if (message.event === 'continued' && session === this.pausedSession) {this.pausedSession = undefined; this.paused = false; this.threadId = undefined; this.onState();}
				}};
			}}),
		];
	}
	get state(): DebuggerState {return {attached: Boolean(this.session), paused: this.paused, busy: this.busy};}
	private owns(session: vscode.DebugSession): boolean {
		for (let current: vscode.DebugSession | undefined = session; current; current = current.parentSession) {
			if (this.token && current.configuration.__valdroidDebug === this.token) {return true;}
		}
		return false;
	}
	async action(action: DebuggerAction): Promise<void> {
		if (!vscode.workspace.isTrusted) {throw new Error('Trust this workspace before debugging.');}
		if (action === 'console') {await vscode.commands.executeCommand('workbench.debug.action.focusRepl'); return;}
		if (this.busy) {return;}
		if (action === 'attach') {await this.attach(); return;}
		if (action === 'detach') {await this.detach(); return;}
		const session = this.pausedSession ?? this.session;
		if (!session) {throw new Error('Attach the Hermes debugger first.');}
		if (!['pause', 'continue', 'next', 'stepIn', 'stepOut'].includes(action)) {throw new Error('Unknown debugger action.');}
		let threadId = this.threadId;
		if (threadId === undefined) {const result = await session.customRequest('threads'); threadId = result?.threads?.[0]?.id;}
		if (threadId === undefined) {throw new Error('No JavaScript debug thread is available.');}
		await session.customRequest(action, {threadId});
	}
	private async attach(): Promise<void> {
		if (this.session) {return;}
		this.busy = true;
		const token = this.token = randomUUID();
		this.issuedTokens.add(token);
		try {
			const app = await this.app();
			const response = await fetch(`http://127.0.0.1:${app.port}/json/list`, {signal: AbortSignal.timeout(5000)});
			if (!response.ok) {throw new Error(`Metro inspector discovery failed: HTTP ${response.status}`);}
			const targets = parseHermesTargets(await response.json(), app.port, app.applicationId);
			if (!targets.length) {throw new Error('No matching Hermes runtime found. Wait for the development app to load; close other React Native debuggers and try again.');}
			const target = targets.length === 1 ? targets[0] : await vscode.window.showQuickPick(targets.map(target => ({label: target.title, description: target.deviceName, target})), {placeHolder: `Select ${app.applicationId} on ${app.serial}`}).then(item => item?.target);
			if (!target || this.token !== token) {return;}
			const current = await this.app();
			if (current.port !== app.port || current.root !== app.root || current.serial !== app.serial) {throw new Error('Expo session changed while attaching. Try again.');}
			this.log('[Valdroid] Attaching VS Code debugger to Hermes. Close React Native DevTools if it is already attached.\n');
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(app.root));
			const transport = await createInspectorTransport(target.websocket, this.log);
			if (this.token !== token) {transport.close(); return;}
			this.transport = transport;
			const configuration = {...hermesDebugConfiguration(app.root, transport.websocket, token, target.websocket), trace: undefined as undefined | {logFile: string}};
			if (this.traceDirectory) {
				await fs.mkdir(this.traceDirectory, {recursive: true});
				configuration.trace = {logFile: path.join(this.traceDirectory, `hermes-${token}.json`)};
				this.log(`[Valdroid] Debugger source-map trace: ${configuration.trace.logFile}\n`);
			}
			if (this.token !== token) {transport.close(); return;}
			const started = await vscode.debug.startDebugging(folder, configuration, {suppressDebugToolbar: true, suppressDebugStatusbar: true, suppressDebugView: true});
			if (!started) {throw new Error('VS Code could not start its JavaScript debugger. Check that the built-in JavaScript Debugger extension is enabled.');}
		} finally {this.busy = false; if (!this.session && this.token === token) {this.token = undefined; this.transport?.close(); this.transport = undefined;}}
	}
	async detach(): Promise<void> {
		const session = this.session;
		this.token = undefined; this.session = undefined; this.threadId = undefined; this.paused = false;
		this.pausedSession = undefined;
		this.transport?.close(); this.transport = undefined;
		this.onState();
		if (session) {await vscode.debug.stopDebugging(session);}
	}
	dispose(): void {for (const subscription of this.subscriptions) {subscription.dispose();} void this.detach();}
}
