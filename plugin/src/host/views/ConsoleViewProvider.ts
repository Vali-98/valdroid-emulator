import * as vscode from 'vscode';
import { AdbConsole } from '../adb/AdbConsole';
import { metroLogLimit, type ConsoleMessage, type ConsoleRequest } from '../../shared/console';
import { webviewHtml } from './html';
import type {ProjectInfo} from '../../shared/protocol';
import {jsLogLimit, type JSLog} from '../../shared/jsConsole';

export class ConsoleViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private selectedSerial?: string;
	private readonly console: AdbConsole;
	private metroText = '';
	private jsRecords: JSLog[] = [];
	private jsID = 0;
	private jsSizes: number[] = [];
	private jsSize = 0;
	appendJS(records: Omit<JSLog, 'id'>[]): void {
		const added = records.map(record => ({...record, id: ++this.jsID}));
		this.jsRecords.push(...added);
		for (const record of added) {const size = JSON.stringify(record).length; this.jsSizes.push(size); this.jsSize += size;}
		while (this.jsRecords.length > jsLogLimit || this.jsSize > 2 * 1024 * 1024) {this.jsRecords.shift(); this.jsSize -= this.jsSizes.shift() ?? 0;}
		this.post({type: 'js-records', records: added, oldestID: this.jsRecords[0]?.id ?? this.jsID + 1});
	}
	private metroRequested = false;
	private projectInfo: ProjectInfo = {type: 'project-info', expo: false, reactNative: false};
	setProjectInfo(info: ProjectInfo): void {this.projectInfo = info; this.post(info);}
	showMetro(): void {this.metroRequested = true; this.post({type: 'metro-snapshot', text: this.metroText, focus: true});}
	appendMetro(text: string): void {
		this.metroText = (this.metroText + text).slice(-metroLogLimit);
		this.post({type: 'metro-output', text});
	}
	constructor(private readonly context: vscode.ExtensionContext, adbPath: string) {
		this.console = new AdbConsole(adbPath, message => this.post(message));
	}
	setDevice(serial?: string): void {
		if (serial === this.selectedSerial) { return; }
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
					case 'console-ready': this.post(this.console.snapshot()); this.post(this.projectInfo); this.post({type: 'metro-snapshot', text: this.metroText, focus: this.metroRequested}); this.post({type: 'js-snapshot', records: this.jsRecords}); break;
					case 'js-clear': this.jsRecords = []; this.jsSizes = []; this.jsSize = 0; this.post({type: 'js-snapshot', records: []}); break;
					case 'metro-clear': this.metroText = ''; this.post({type: 'metro-snapshot', text: ''}); break;
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
	private post(message: ConsoleMessage): void { void this.view?.webview.postMessage(message); }
	async dispose(): Promise<void> { await this.console.dispose(); }
}
