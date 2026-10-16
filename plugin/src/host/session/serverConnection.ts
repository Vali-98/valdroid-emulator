import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export const preferredHTTPAddress = '127.0.0.1:38475';
export const preferredAgentAddress = '127.0.0.1:38476';

export function waitForServerAddress(child: ChildProcess, timeout = 15000): Promise<string> {
	return new Promise((resolve, reject) => {
		if (!child.stdout) {reject(new Error('Control server did not provide its startup channel')); return;}
		const lines = createInterface({ input: child.stdout });
		const finish = (error?: Error, address?: string) => {
			clearTimeout(timer);
			lines.off('line', receive);
			lines.close();
			child.stdout?.resume();
			child.off('error', fail);
			child.off('exit', exited);
			if (error) {reject(error);} else {resolve(address!);}
		};
		const fail = (error: Error) => finish(error);
		const exited = (code: number | null, signal: NodeJS.Signals | null) =>
			finish(new Error(`Control server exited before announcing its ports (${signal || code}). See the Valdroid Emulator output channel.`));
		const receive = (line: string) => {
			let message: { type?: string; httpUrl?: string };
			try {message = JSON.parse(line);} catch {return;}
			if (message?.type !== 'server-listening') {return;}
			try {
				const url = new URL(message.httpUrl || '');
				if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1
					|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
					throw new Error('Invalid listener URL');
				}
				finish(undefined, url.origin);
			} catch {finish(new Error('Control server announced an invalid HTTP listener'));}
		};
		const timer = setTimeout(() => finish(new Error('Timed out waiting for the control server to announce its ports. Rebuild the bundled control server and check the Valdroid Emulator output channel.')), timeout);
		lines.on('line', receive);
		child.once('error', fail);
		child.once('exit', exited);
		if (child.exitCode !== null || child.signalCode !== null) {exited(child.exitCode, child.signalCode);}
	});
}
