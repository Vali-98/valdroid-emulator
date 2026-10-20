import * as vscode from 'vscode';
import type { EmulatorTarget, ExtensionMessage, HostMessage, SessionState } from '../../shared/protocol';
import { webviewHtml } from './html';
import { applyInitialPanelSize } from './initialPanelSize';
import { FileUploadReceiver, type TransferFile } from '../files/FileUploadReceiver';

export class EmulatorViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private serverUrl?: string;
	private deviceName?: string;
	private uploads?: FileUploadReceiver;
	private lastTarget?: string;
	private noticeID = 0;
	private retrying = false;
	private projectInfo: import('../../shared/protocol').ProjectInfo = {type: 'project-info', expo: false, reactNative: false};
	private launchProgress: import('../../shared/protocol').LaunchProgress = {type: 'launch-progress', busy: false, status: ''};
	private expoTarget?: string;
	setProjectInfo(info: import('../../shared/protocol').ProjectInfo): void {this.projectInfo = info; this.postMessage(info);}
	setLaunchProgress(status: string): void {this.launchProgress = {type: 'launch-progress', busy: true, status}; this.postMessage(this.launchProgress);}

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly listTargets: () => Promise<EmulatorTarget[]>,
		private readonly startTarget: (value: string) => Promise<void>,
		private readonly stopEmulator: () => Promise<void>,
		private readonly getSerial: () => string | undefined,
		private readonly transferFile: TransferFile,
		private readonly output: vscode.OutputChannel,
		private readonly disconnectStream?: (reason: string) => Promise<void>,
		private readonly expo?: {start: (value: string) => Promise<void>; toggle: (enabled: boolean) => void; state: () => {active: boolean; enabled: boolean; connected: boolean}; inspect?: (request: import('../../shared/inspector').InspectorRequest) => void; openSource?: (id: number, index: number) => Promise<void>; showHierarchy?: (id: number, index: number) => Promise<void>},
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		void this.uploads?.dispose();
		const uploads = new FileUploadReceiver(this.getSerial, this.transferFile);
		this.uploads = uploads;
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
				vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			],
		};
		webviewView.webview.html = webviewHtml(webviewView.webview, this.context.extensionUri);
		const messages = webviewView.webview.onDidReceiveMessage(async (message: HostMessage) => {
			try {
				if (message.type === 'upload-start' || message.type === 'upload-chunk' || message.type === 'upload-finish' || message.type === 'upload-cancel') {
					try {
						const result = await uploads.handle(message, percent => {
							void webviewView.webview.postMessage({ type: 'upload-progress', id: message.id, percent } satisfies ExtensionMessage);
						});
						void webviewView.webview.postMessage({ type: 'upload-result', id: message.id, requestId: message.requestId, result } satisfies ExtensionMessage);
					} catch (error) {
						const detail = error instanceof Error ? error.message : String(error);
						this.output.appendLine(`File transfer failed: ${detail}`);
						void webviewView.webview.postMessage({ type: 'upload-result', id: message.id, requestId: message.requestId, error: detail } satisfies ExtensionMessage);
					}
					return;
				}
				switch (message.type) {
					case 'inspect-show-hierarchy': await this.expo?.showHierarchy?.(message.id, message.index); break;
					case 'inspect-point': this.expo?.inspect?.(message); break;
					case 'inspect-open-source': await this.expo?.openSource?.(message.id, message.index); break;
					case 'expo-preference':
						if (typeof message.enabled === 'boolean') {await this.context.workspaceState.update('valdroid.launchWithExpo', message.enabled);}
						break;
					case 'start-expo': await this.startExpo(message.value); break;
					case 'scan-toggle': this.expo?.toggle(message.enabled); this.postDevtools(); break;
					case 'devtools-refresh': this.postDevtools(); break;
					case 'ready':
						this.postMessage({type: 'expo-preference', enabled: this.context.workspaceState?.get<boolean>('valdroid.launchWithExpo', false) ?? false});
						this.postMessage(this.projectInfo); this.postMessage(this.launchProgress);
						await applyInitialPanelSize(this.context, webviewView, () => vscode.commands.executeCommand('workbench.action.increaseViewSize'))
							.catch(error => this.output.appendLine(`Could not adjust initial emulator panel size: ${String(error)}`));
						await this.refreshTargets();
						this.postStatus();
						break;
					case 'refresh':
						await this.refreshTargets();
						break;
					case 'start':
						if (message.value) {
							await this.start(message.value);
						}
						break;
					case 'retry':
						if (this.expoTarget) {await this.startExpo(this.expoTarget); break;}
						if (this.lastTarget && !this.retrying) {
							this.retrying = true;
							try {
								this.output.appendLine('Retrying emulator load sequence.');
								await this.stopEmulator();
								this.setStatus('Starting emulator and Android agent…', 'online');
								await this.start(this.lastTarget);
							} finally {this.retrying = false;}
						}
						break;
					case 'client-error':
						if (message.serverUrl === this.serverUrl) {
							if (message.fatal && this.disconnectStream) {await this.disconnectStream(message.message);}
							else {this.notify(message.message, 'error');}
						}
						break;
					case 'stop':
					case 'close':
						await uploads.cancelAll();
						await this.stopEmulator();
						this.setServer(undefined);
						this.notify('Disconnected from emulator.', 'info');
						break;
				}
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				this.notify(detail, 'error'); this.setStatus(detail, 'error');
			}
		});
		webviewView.onDidDispose(() => {
			void uploads.dispose();
			messages.dispose();
			if (this.view === webviewView) {this.view = undefined;}
		});
	}

	async refreshTargets(): Promise<void> {
		const targets = await this.listTargets();
		this.postMessage({ type: 'targets', targets });
	}

	async start(value: string): Promise<void> {
		this.expoTarget = undefined;
		this.lastTarget = value;
		this.setStatus(value.startsWith('avd:') ? 'Starting emulator…' : 'Connecting to device…', 'online');
		await this.startTarget(value);
	}
	private async startExpo(value: string): Promise<void> {
		if (this.launchProgress.busy || !this.expo) {return;}
		this.expoTarget = value;
		this.setLaunchProgress('Starting Expo session…');
		try {await this.expo.start(value); this.postDevtools();}
		finally {this.launchProgress = {type: 'launch-progress', busy: false, status: ''}; this.postMessage(this.launchProgress);}
	}

	setServer(serverUrl?: string, deviceName?: string): void {
		if (this.serverUrl !== serverUrl) {void this.uploads?.cancelAll();}
		this.serverUrl = serverUrl;
		this.deviceName = serverUrl ? deviceName : undefined;
		this.postStatus();
	}

	async cancelUploads(): Promise<void> {await this.uploads?.cancelAll();}
	postOutlines(batch: import('../../shared/scan').ScanOutlines): void {this.postMessage(batch);}
	postInspection(result: import('../../shared/inspector').InspectorResult): void {this.postMessage(result);}
	postHierarchyHighlight(highlight: import('../../shared/hierarchy').HierarchyHighlight): void {this.postMessage(highlight);}

	notify(message: string, level: 'info' | 'error'): void {
		this.output.appendLine(`${level === 'error' ? 'Error' : 'Notice'}: ${message}`);
		this.noticeID = Math.max(Date.now(), this.noticeID + 1);
		this.postMessage({type: 'notice', id: this.noticeID, message, level});
	}

	setStatus(status: string, state: SessionState): void {
		this.postMessage({ type: 'status', status, state, serverUrl: this.serverUrl, deviceName: this.deviceName });
	}

	private postStatus(): void {
		this.setStatus(this.serverUrl ? 'Connecting to emulator' : 'Select an emulator', this.serverUrl ? 'online' : 'idle');
	}

	private postMessage(message: ExtensionMessage): void {
		void this.view?.webview.postMessage(message);
	}
	private postDevtools(): void {this.postMessage({type: 'devtools', ...(this.expo?.state() ?? {active: false, enabled: false, connected: false})});}
}
