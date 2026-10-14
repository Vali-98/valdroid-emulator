import * as vscode from 'vscode';
import type { EmulatorTarget } from '../lib/targets';

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
		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(async (message: { type?: string; value?: string }) => {
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
	}

	async refreshTargets(): Promise<void> {
		const targets = await this.listTargets();
		this.view?.webview.postMessage({ type: 'targets', targets });
	}

	setServer(serverUrl?: string, deviceName?: string): void {
		this.serverUrl = serverUrl;
		this.deviceName = serverUrl ? deviceName : undefined;
		this.postStatus();
	}

	setStatus(status: string, state: 'idle' | 'online' | 'error'): void {
		this.view?.webview.postMessage({ type: 'status', status, state, serverUrl: this.serverUrl, deviceName: this.deviceName });
	}

	private postStatus(): void {
		this.setStatus(this.serverUrl ? 'Connecting to emulator' : 'Select an emulator', this.serverUrl ? 'online' : 'idle');
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
		const csp = `default-src 'none'; img-src http://127.0.0.1:* data: blob:; connect-src http://127.0.0.1:* ws://127.0.0.1:*; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval';`;
		return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
