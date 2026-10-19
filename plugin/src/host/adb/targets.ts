import type * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { runFile } from '../session/process';
import type { EmulatorTarget } from '../../shared/protocol';

export interface RunningDevice { serial: string; avdName?: string; }

async function avdAbi(name: string): Promise<string | undefined> {
	const androidHome = process.env.ANDROID_USER_HOME || process.env.ANDROID_EMULATOR_HOME || path.join(homedir(), '.android');
	const avdHome = process.env.ANDROID_AVD_HOME || path.join(androidHome, 'avd');
	try {
		const ini = await readFile(path.join(avdHome, `${name}.ini`), 'utf8').catch(() => '');
		const directory = /^path\s*=\s*(.+)$/m.exec(ini)?.[1]?.trim() || path.join(avdHome, `${name}.avd`);
		const config = await readFile(path.join(directory, 'config.ini'), 'utf8');
		return /^abi\.type\s*=\s*(.+)$/m.exec(config)?.[1]?.trim();
	} catch {return undefined;}
}

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
	const targets: EmulatorTarget[] = [
		...running.map(device => ({label: device.avdName ? `${device.avdName} (${device.serial})` : device.serial,
			value: `device:${device.serial}`, avdName: device.avdName})),
		...available.filter(name => !runningNames.has(name)).map(name => ({label: name, value: `avd:${name}`, avdName: name})),
	];
	return Promise.all(targets.map(async target => {
		const abi = target.value.startsWith('device:')
			? await runFile(adbPath, ['-s', target.value.slice(7), 'shell', 'getprop', 'ro.product.cpu.abi']).then(value => value.trim()).catch(() => undefined)
			: target.avdName ? await avdAbi(target.avdName) : undefined;
		return abi ? {...target, abi} : target;
	}));
}
