import * as vscode from 'vscode';
import type { EmulatorTarget, ExtensionMessage, HostMessage, SessionState } from '../shared/protocol';
import { webviewHtml } from './html';

export class EmulatorViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private serverUrl?: string;
	private deviceName?: string;

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
		webviewView.webview.html = webviewHtml(webviewView.webview, this.context.extensionUri);
		const messages = webviewView.webview.onDidReceiveMessage(async (message: HostMessage) => {
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
						if (message.value) {
							this.setStatus(message.value.startsWith('avd:') ? 'Starting emulator...' : 'Starting Android agent...', 'online');
							await this.startTarget(message.value);
						}
						break;
					case 'stop':
					case 'close':
						await this.stopEmulator();
						this.setServer(undefined);
						break;
				}
			} catch (error) {
				this.setStatus(error instanceof Error ? error.message : String(error), 'error');
			}
		});
		webviewView.onDidDispose(() => {
			messages.dispose();
			if (this.view === webviewView) {this.view = undefined;}
		});
	}

	async refreshTargets(): Promise<void> {
		const targets = await this.listTargets();
		this.postMessage({ type: 'targets', targets });
	}

	setServer(serverUrl?: string, deviceName?: string): void {
		this.serverUrl = serverUrl;
		this.deviceName = serverUrl ? deviceName : undefined;
		this.postStatus();
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
}
