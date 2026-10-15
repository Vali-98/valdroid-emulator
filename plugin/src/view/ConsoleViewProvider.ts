import * as vscode from 'vscode';
import { AdbConsole } from '../lib/AdbConsole';
import type { ConsoleMessage, ConsoleRequest } from '../shared/console';
import type { EmulatorTarget } from '../shared/protocol';
import { webviewHtml } from './html';

export class ConsoleViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private selectedSerial?: string;
	private readonly console: AdbConsole;
	constructor(private readonly context: vscode.ExtensionContext, adbPath: string, private readonly discover: () => Promise<EmulatorTarget[]>) {
		this.console = new AdbConsole(adbPath, message => this.post(message));
	}
	setDevice(serial?: string): void {
		this.selectedSerial = serial;
		if (this.view) { void this.console.selectDevice(serial); }
	}
	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
		view.webview.html = webviewHtml(view.webview, this.context.extensionUri, 'console');
		const messages = view.webview.onDidReceiveMessage(async (message: ConsoleRequest) => {
			try {
				switch (message.type) {
					case 'console-ready': this.post(this.console.snapshot()); await this.refresh(); break;
					case 'console-refresh': await this.refresh(); break;
					case 'console-device':
						if (message.serial && !(await this.devices()).some(device => device.serial === message.serial)) { throw new Error('Android device is no longer connected'); }
						this.selectedSerial = message.serial || undefined;
						await this.console.selectDevice(this.selectedSerial); break;
					case 'console-command': if (typeof message.command === 'string') { await this.console.execute(message.command); } break;
					case 'console-cancel': await this.console.cancelCommand(); break;
					case 'console-clear': this.console.clear(); break;
					case 'console-toggle': await this.console.toggle(); break;
					case 'console-copy': if (typeof message.text === 'string') { await vscode.env.clipboard.writeText(message.text.slice(0, 8*1024*1024)); } break;
				}
			} catch (error) { this.console.notice(error instanceof Error ? error.message : String(error), true); }
		});
		view.onDidDispose(() => { messages.dispose(); if (this.view === view) { this.view = undefined; void this.console.selectDevice(undefined); } });
		void this.console.selectDevice(this.selectedSerial);
	}
	private async devices(): Promise<{ label: string; serial: string }[]> {
		return (await this.discover()).filter(device => device.value.startsWith('device:')).map(device => ({ label: device.label, serial: device.value.slice(7) }));
	}
	private async refresh(): Promise<void> { this.post({ type: 'console-devices', devices: await this.devices() }); }
	private post(message: ConsoleMessage): void { void this.view?.webview.postMessage(message); }
	async dispose(): Promise<void> { await this.console.dispose(); }
}
