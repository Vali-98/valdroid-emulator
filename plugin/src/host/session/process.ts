import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const execFileAsync = promisify(execFile);

export async function runFile(file: string, args: string[], options: {signal?: AbortSignal; timeout?: number} = {}): Promise<string> {
	try {
		const { stdout } = await execFileAsync(file, args, { encoding: 'utf8', timeout: options.timeout ?? 15000, signal: options.signal });
		return stdout;
	} catch (error) {
		const failure = error as Error & { stderr?: string };
		throw new Error(`${path.basename(file)} failed: ${failure.stderr?.trim() || failure.message}`);
	}
}

export async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	await sleep(milliseconds, undefined, {signal});
}

export async function waitForExit(child: ChildProcess, timeout: number): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {return;}
	await new Promise<void>(resolve => {
		const finish = () => {
			clearTimeout(timer);
			child.off('exit', finish);
			resolve();
		};
		const timer = setTimeout(finish, timeout);
		child.once('exit', finish);
		if (child.exitCode !== null || child.signalCode !== null) {finish();}
	});
}

export async function terminateProcess(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {return;}
	child.kill('SIGTERM');
	await waitForExit(child, 5000);
	if (child.exitCode === null && child.signalCode === null) {
		child.kill('SIGKILL');
		await waitForExit(child, 1000);
	}
}

export function defaultEmulatorPath(): string {
	const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Android', 'sdk') : '');
	return sdk ? path.join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator') : 'emulator';
}

export function platformTarget(): string {
	const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
	return `${platform}-${process.arch}`;
}
