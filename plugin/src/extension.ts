import * as vscode from 'vscode';
import { EmulatorSession } from './lib/EmulatorSession';
import { defaultEmulatorPath } from './lib/process';
import { listTargets } from './lib/targets';
import { EmulatorViewProvider } from './view/EmulatorViewProvider';

let shutdownExtension: (() => Promise<void>) | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Valdroid Emulator');
	const configuration = vscode.workspace.getConfiguration('valdroid-emulator');
	const adbPath = configuration.get<string>('adbPath', 'adb');
	const emulatorPath = configuration.get<string>('emulatorPath', '') || defaultEmulatorPath();
	const bitRate = configuration.get<number>('bitRate', 10000000);
	const discover = () => listTargets(emulatorPath, adbPath, output);
	let session: EmulatorSession;
	const provider = new EmulatorViewProvider(context, discover, value => session.startTarget(value), () => session.stop());
	session = new EmulatorSession(context.extensionPath, adbPath, emulatorPath, bitRate, output, provider);
	shutdownExtension = () => session.stop();

	context.subscriptions.push(
		output,
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
		vscode.commands.registerCommand('valdroid-emulator.stop', () => session.stop()),
		{ dispose: () => { void session.stop(); } },
	);
}

export async function deactivate(): Promise<void> {
	await shutdownExtension?.();
	shutdownExtension = undefined;
}
