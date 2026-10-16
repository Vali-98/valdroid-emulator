import type { ServerStatus } from '../../shared/protocol';
import { runFile } from './process';

// Sequential, bounded checks; a static display is healthy even without new frames.
export function monitorSession(adbPath: string, serial: string, baseUrl: string, disconnected: (reason: string) => void) {
	const owner = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	let failures = 0;
	const check = async () => {
		const [device, server] = await Promise.allSettled([
			runFile(adbPath, ['-s', serial, 'get-state'], {signal: owner.signal, timeout: 3000}),
			fetch(`${baseUrl}/api/status`, {signal: AbortSignal.any([owner.signal, AbortSignal.timeout(3000)])})
				.then(async response => {if (!response.ok) {throw new Error(`HTTP ${response.status}`);} return await response.json() as ServerStatus;}),
		]);
		if (owner.signal.aborted) {return;}
		let reason: string | undefined;
		if (device.status === 'rejected' || device.value.trim() !== 'device') {reason = `Device ${serial} disconnected or is unavailable.`;}
		else if (server.status === 'rejected') {reason = 'Lost connection to the control server.';}
		else if (server.value?.agentError) {reason = `Android agent failed: ${server.value.agentError}`;}
		else if (!server.value?.videoConnected || !server.value?.controlConnected) {reason = 'Android agent disconnected.';}
		failures = reason ? failures + 1 : 0;
		if (reason && failures >= 2) {owner.abort(); disconnected(reason); return;}
		timer = setTimeout(() => {void check();}, 2000);
	};
	timer = setTimeout(() => {void check();}, 2000);
	return () => {owner.abort(); clearTimeout(timer);};
}
