import { runFile } from '../session/process';

// Expo's --device resolver matches device.name, while ADB operations use the serial.
export async function resolveExpoDeviceName(adbPath: string, serial: string): Promise<string> {
	if (serial.startsWith('emulator-')) {
		const output = await runFile(adbPath, ['-s', serial, 'emu', 'avd', 'name']);
		const name = output.split(/\r?\n/).map(line => line.trim()).find(line => line && line !== 'OK' && !line.startsWith('KO:'));
		if (!name) {throw new Error(`Could not resolve the Expo AVD name for ${serial}.`);}
		return name;
	}
	const devices = await runFile(adbPath, ['devices', '-l']);
	const line = devices.split(/\r?\n/).find(value => value.trim().split(/\s+/)[0] === serial);
	if (!line || line.trim().split(/\s+/)[1] !== 'device') {throw new Error(`Android device ${serial} is not connected or authorized.`);}
	return /\bmodel:(\S+)/.exec(line)?.[1] ?? `Device ${serial}`;
}
