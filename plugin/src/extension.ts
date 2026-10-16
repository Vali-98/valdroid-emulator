import * as vscode from 'vscode';
import { EmulatorSession } from './host/session/EmulatorSession';
import { resolveAndroidTools } from './host/adb/toolPaths';
import { listTargets } from './host/adb/targets';
import { EmulatorViewProvider } from './host/views/EmulatorViewProvider';
import { ConsoleViewProvider } from './host/views/ConsoleViewProvider';

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
	const provider = new EmulatorViewProvider(context, discover, value => session.startTarget(value), () => session.stop(),
		() => session.deviceSerial, (file, name, serial, signal, progress) => session.transferFile(file, name, serial, signal, progress), output,
		reason => session.disconnect(reason));
	session = new EmulatorSession(context.extensionPath, adbPath, emulatorPath, bitRate, output, provider, serial => console.setDevice(serial));
	shutdownExtension = async () => {await provider.cancelUploads(); await session.stop();};

	context.subscriptions.push(
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
