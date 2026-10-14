import type * as vscode from 'vscode';
import { runFile } from './process';
import type { EmulatorTarget } from '../shared/protocol';

export async function listTargets(emulatorPath: string, adbPath: string, output: vscode.OutputChannel): Promise<EmulatorTarget[]> {
	const targets: EmulatorTarget[] = [];
	try {
		const avdOutput = await runFile(emulatorPath, ['-list-avds']);
		for (const avd of avdOutput.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
			targets.push({ label: `AVD · ${avd}`, value: `avd:${avd}` });
		}
	} catch (error) {
		output.appendLine(`Could not list AVDs: ${String(error)}`);
	}
	try {
		const devices = await runFile(adbPath, ['devices']);
		for (const line of devices.split(/\r?\n/).slice(1)) {
			const [serial, state] = line.trim().split(/\s+/);
			if (serial && state === 'device') {targets.push({ label: `Running · ${serial}`, value: `device:${serial}` });}
		}
	} catch (error) {
		output.appendLine(`Could not list ADB devices: ${String(error)}`);
	}
	return targets;
}
