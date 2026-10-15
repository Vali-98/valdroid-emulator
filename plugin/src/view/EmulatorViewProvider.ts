import * as vscode from 'vscode';
import type { EmulatorTarget, ExtensionMessage, HostMessage, SessionState } from '../shared/protocol';
import { webviewHtml } from './html';
import { applyInitialPanelSize } from './initialPanelSize';
import { FileUploadReceiver, type PushFile } from '../lib/FileUploadReceiver';

export class EmulatorViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private serverUrl?: string;
	private deviceName?: string;
	private uploads?: FileUploadReceiver;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly listTargets: () => Promise<EmulatorTarget[]>,
		private readonly startTarget: (value: string) => Promise<void>,
		private readonly stopEmulator: () => Promise<void>,
		private readonly getSerial: () => string | undefined,
		private readonly pushFile: PushFile,
		private readonly output: vscode.OutputChannel,
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		void this.uploads?.dispose();
		const uploads = new FileUploadReceiver(this.getSerial, this.pushFile);
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
						const path = await uploads.handle(message, percent => {
							void webviewView.webview.postMessage({ type: 'upload-progress', id: message.id, percent } satisfies ExtensionMessage);
						});
						void webviewView.webview.postMessage({ type: 'upload-result', id: message.id, requestId: message.requestId, path } satisfies ExtensionMessage);
					} catch (error) {
						const detail = error instanceof Error ? error.message : String(error);
						this.output.appendLine(`File transfer failed: ${detail}`);
						void webviewView.webview.postMessage({ type: 'upload-result', id: message.id, requestId: message.requestId, error: detail } satisfies ExtensionMessage);
					}
					return;
				}
				switch (message.type) {
					case 'ready':
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
							this.setStatus(message.value.startsWith('avd:') ? 'Starting emulator...' : 'Starting Android agent...', 'online');
							await this.startTarget(message.value);
						}
						break;
					case 'stop':
					case 'close':
						await uploads.cancelAll();
						await this.stopEmulator();
						this.setServer(undefined);
						break;
				}
			} catch (error) {
				this.setStatus(error instanceof Error ? error.message : String(error), 'error');
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

	setServer(serverUrl?: string, deviceName?: string): void {
		if (this.serverUrl !== serverUrl) {void this.uploads?.cancelAll();}
		this.serverUrl = serverUrl;
		this.deviceName = serverUrl ? deviceName : undefined;
		this.postStatus();
	}

	async cancelUploads(): Promise<void> {await this.uploads?.cancelAll();}

	setStatus(status: string, state: SessionState): void {
		this.postMessage({ type: 'status', status, state, serverUrl: this.serverUrl, deviceName: this.deviceName });
	}

	private postStatus(): void {
		this.setStatus(this.serverUrl ? 'Connecting to emulator' : 'Select an emulator', this.serverUrl ? 'online' : 'idle');
	}

	private postMessage(message: ExtensionMessage): void {
		void this.view?.webview.postMessage(message);
	}
}
