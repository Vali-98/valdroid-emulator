import type * as vscode from 'vscode';
import { runFile } from '../session/process';
import type { EmulatorTarget } from '../../shared/protocol';

export interface RunningDevice { serial: string; avdName?: string; }

export async function listRunningDevices(adbPath: string, signal?: AbortSignal): Promise<RunningDevice[]> {
	const output = await runFile(adbPath, ['devices'], signal ? {signal} : undefined);
	const serials = [...new Set(output.split(/\r?\n/).slice(1).flatMap(line => {
		const [serial, state] = line.trim().split(/\s+/);
		return serial && state === 'device' ? [serial] : [];
	}))];
	return Promise.all(serials.map(async serial => {
		if (!serial.startsWith('emulator-')) {return {serial};}
		const name = await runFile(adbPath, ['-s', serial, 'emu', 'avd', 'name'], signal ? {signal} : undefined).catch(() => '');
		const avdName = name.split(/\r?\n/).map(line => line.trim()).find(line => line && line !== 'OK' && !line.startsWith('KO:'));
		return {serial, avdName};
	}));
}

export async function listTargets(emulatorPath: string, adbPath: string, output: vscode.OutputChannel): Promise<EmulatorTarget[]> {
	const [avds, devices] = await Promise.allSettled([
		runFile(emulatorPath, ['-list-avds']),
		listRunningDevices(adbPath),
	]);
	if (avds.status === 'rejected') {output.appendLine(`Could not list AVDs: ${String(avds.reason)}`);}
	if (devices.status === 'rejected') {output.appendLine(`Could not list ADB devices: ${String(devices.reason)}`);}
	const running = devices.status === 'fulfilled' ? devices.value : [];
	const runningNames = new Set(running.map(device => device.avdName).filter(Boolean));
	const available = avds.status === 'fulfilled' ? [...new Set(avds.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean))] : [];
	return [
		...running.map(device => ({label: device.avdName ? `${device.avdName} (${device.serial})` : device.serial,
			value: `device:${device.serial}`, avdName: device.avdName})),
		...available.filter(name => !runningNames.has(name)).map(name => ({label: name, value: `avd:${name}`, avdName: name})),
	];
}
