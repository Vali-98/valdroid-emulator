import * as vscode from 'vscode';
import { EmulatorSession } from './host/session/EmulatorSession';
import { defaultEmulatorPath } from './host/session/process';
import { listTargets } from './host/adb/targets';
import { EmulatorViewProvider } from './host/views/EmulatorViewProvider';
import { ConsoleViewProvider } from './host/views/ConsoleViewProvider';

let shutdownExtension: (() => Promise<void>) | undefined;
let shutdownConsole: (() => Promise<void>) | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Valdroid Emulator');
	const configuration = vscode.workspace.getConfiguration('valdroid-emulator');
	const adbPath = configuration.get<string>('adbPath', 'adb');
	const emulatorPath = configuration.get<string>('emulatorPath', '') || defaultEmulatorPath();
	const bitRate = configuration.get<number>('bitRate', 10000000);
	const discover = () => listTargets(emulatorPath, adbPath, output);
	const console = new ConsoleViewProvider(context, adbPath);
	shutdownConsole = () => console.dispose();
	let session: EmulatorSession;
	const provider = new EmulatorViewProvider(context, discover, value => session.startTarget(value), () => session.stop(),
		() => session.deviceSerial, (file, name, serial, signal, progress) => session.transferFile(file, name, serial, signal, progress), output);
	session = new EmulatorSession(context.extensionPath, adbPath, emulatorPath, bitRate, output, provider, serial => console.setDevice(serial));
	shutdownExtension = async () => {await provider.cancelUploads(); await session.stop();};

	context.subscriptions.push(
		output,
		vscode.window.registerWebviewViewProvider('valdroidConsole.view', console, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('valdroid-emulator.console', () => vscode.commands.executeCommand('workbench.view.extension.valdroidConsole')),
		vscode.window.registerWebviewViewProvider('valdroidEmulator.view', provider, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('valdroid-emulator.show', () => vscode.commands.executeCommand('workbench.view.extension.valdroidEmulator')),
		vscode.commands.registerCommand('valdroid-emulator.start', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.valdroidEmulator');
			const chosen = await vscode.window.showQuickPick(await discover(), { placeHolder: 'Select an Android AVD or connected device' });
			if (chosen) {
				await provider.refreshTargets();
				await session.startTarget(chosen.value);
			}
		}),
		vscode.commands.registerCommand('valdroid-emulator.stop', shutdownExtension),
		{ dispose: () => { void console.dispose(); void shutdownExtension?.(); } },
	);
}

export async function deactivate(): Promise<void> {
	await shutdownConsole?.();
	shutdownConsole = undefined;
	await shutdownExtension?.();
	shutdownExtension = undefined;
}
