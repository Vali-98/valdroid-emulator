import * as vscode from 'vscode';
import { EmulatorSession } from './host/session/EmulatorSession';
import { resolveAndroidTools } from './host/adb/toolPaths';
import { listTargets } from './host/adb/targets';
import { EmulatorViewProvider } from './host/views/EmulatorViewProvider';
import { ConsoleViewProvider } from './host/views/ConsoleViewProvider';
import { ExpoSession } from './host/reactNative/ExpoSession';
import { ReactScanIntegration } from './host/reactNative/ReactScanIntegration';
import {detectProjects} from './host/reactNative/projectDetection';

let shutdownExtension: (() => Promise<void>) | undefined;
let shutdownConsole: (() => Promise<void>) | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Valdroid Emulator');
	const configuration = vscode.workspace.getConfiguration('valdroid-emulator');
	const {adbPath, emulatorPath} = resolveAndroidTools({
		sdkPath: configuration.get<string>('sdkPath', ''), adbPath: configuration.get<string>('adbPath', ''),
		emulatorPath: configuration.get<string>('emulatorPath', ''),
	});
	output.appendLine(`ADB executable: ${adbPath}`);
	output.appendLine(`Emulator executable: ${emulatorPath}`);
	const bitRate = configuration.get<number>('bitRate', 10000000);
	const discover = () => listTargets(emulatorPath, adbPath, output);
	const console = new ConsoleViewProvider(context, adbPath);
	shutdownConsole = () => console.dispose();
	let session: EmulatorSession;
	let startingExpo = false;
	const expo = new ExpoSession(context.extensionPath, adbPath, text => console.appendMetro(text), batch => provider.postOutlines(batch), status => provider.setLaunchProgress(status), records => console.appendJS(records), result => provider.postInspection(result), context.globalStorageUri.fsPath);
	const stop = async () => {await expo.stop(); await session.stop();};
	const provider = new EmulatorViewProvider(context, discover, async value => {await expo.stop(); await session.startTarget(value);}, stop,
		() => session.deviceSerial, (file, name, serial, signal, progress) => session.transferFile(file, name, serial, signal, progress), output,
		async reason => {await expo.stop(); await session.disconnect(reason);}, {
			start: async value => {
				if (startingExpo) {return;}
				startingExpo = true;
				try {
					if (!vscode.workspace.isTrusted) {throw new Error('Trust this workspace before starting Expo.');}
					const folders = vscode.workspace.workspaceFolders ?? [];
					const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({placeHolder: 'Select the Expo project'});
					if (!folder) {throw new Error('Open an Expo project folder in VS Code first.');}
					await ReactScanIntegration.inspect(folder.uri.fsPath);
					await expo.stop();
					console.showMetro();
					await vscode.commands.executeCommand('workbench.view.extension.valdroidConsole');
					provider.setLaunchProgress('Starting emulator…');
					await session.startTarget(value);
					const serial = session.deviceSerial;
					if (!serial) {throw new Error('No connected Android device.');}
					provider.setLaunchProgress('Starting Metro…');
					await expo.start(folder.uri.fsPath, serial);
				} finally {startingExpo = false;}
			},
			toggle: enabled => expo.setScan(enabled), state: () => expo.state,
			inspect: request => expo.inspect(request),
			openSource: async (id, index) => {
				const source = await expo.inspectorSource(id, index);
				if (!source) {provider.notify('Source location is unavailable for this component.', 'info'); return;}
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(source.fileName));
				const position = new vscode.Position(source.lineNumber - 1, Math.max(0, source.columnNumber - 1));
				await vscode.window.showTextDocument(document, {selection: new vscode.Range(position, position), preview: true});
			},
		});
	session = new EmulatorSession(context.extensionPath, adbPath, emulatorPath, bitRate, output, provider, serial => console.setDevice(serial));
	shutdownExtension = async () => {await provider.cancelUploads(); await stop();};
	let detectionVersion = 0;
	const refreshProjectInfo = async () => {
		const version = ++detectionVersion;
		const info = await detectProjects((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
		if (version === detectionVersion) {provider.setProjectInfo(info); console.setProjectInfo(info);}
	};
	const manifests = vscode.workspace.createFileSystemWatcher('**/package.json');
	const manifestChanged = (uri: vscode.Uri) => {
		if ((vscode.workspace.workspaceFolders ?? []).some(folder => vscode.Uri.joinPath(folder.uri, 'package.json').toString() === uri.toString())) {void refreshProjectInfo();}
	};
	void refreshProjectInfo();

	context.subscriptions.push(
		manifests, manifests.onDidCreate(manifestChanged), manifests.onDidChange(manifestChanged), manifests.onDidDelete(manifestChanged),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {void refreshProjectInfo();}),
		output,
		vscode.commands.registerCommand('valdroid-emulator.settings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Vali-98.valdroid-emulator')),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (!['sdkPath', 'adbPath', 'emulatorPath', 'bitRate'].some(key => event.affectsConfiguration(`valdroid-emulator.${key}`))) {return;}
			void vscode.window.showInformationMessage('Reload the window to apply Valdroid settings.', 'Reload Window').then(choice => {
				if (choice === 'Reload Window') {return vscode.commands.executeCommand('workbench.action.reloadWindow');}
			});
		}),
		vscode.window.registerWebviewViewProvider('valdroidConsole.view', console, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('valdroid-emulator.console', () => vscode.commands.executeCommand('workbench.view.extension.valdroidConsole')),
		vscode.window.registerWebviewViewProvider('valdroidEmulator.view', provider, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('valdroid-emulator.show', () => vscode.commands.executeCommand('workbench.view.extension.valdroidEmulator')),
		vscode.commands.registerCommand('valdroid-emulator.start', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.valdroidEmulator');
			const chosen = await vscode.window.showQuickPick(await discover(), { placeHolder: 'Select an Android AVD or connected device' });
			if (chosen) {
				await provider.refreshTargets();
				try {await provider.start(chosen.value);} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					provider.notify(detail, 'error'); provider.setStatus(detail, 'error');
				}
			}
		}),
		vscode.commands.registerCommand('valdroid-emulator.stop', async () => {await shutdownExtension?.(); provider.notify('Disconnected from emulator.', 'info');}),
		{ dispose: () => { void console.dispose(); void shutdownExtension?.(); } },
	);
}

export async function deactivate(): Promise<void> {
	await shutdownConsole?.();
	shutdownConsole = undefined;
	await shutdownExtension?.();
	shutdownExtension = undefined;
}
