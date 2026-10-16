// @vitest-environment node
import type * as vscode from 'vscode';
import { expect, it, vi } from 'vitest';
import { EmulatorViewProvider } from '../../src/host/views/EmulatorViewProvider';
import type { HostMessage } from '../../src/shared/protocol';

vi.mock('vscode', () => ({Uri: {joinPath: () => '/resource'}, commands: {executeCommand: vi.fn()}}));

function fixture() {
	let receive!: (message: HostMessage) => Promise<void>;
	const postMessage = vi.fn(); const output = {appendLine: vi.fn()};
	const start = vi.fn(async (_value: string) => undefined), stop = vi.fn(async () => undefined), disconnect = vi.fn(async (_reason: string) => undefined);
	const provider = new EmulatorViewProvider({extensionUri: '/extension'} as unknown as vscode.ExtensionContext,
		async () => [], start, stop, () => undefined, vi.fn(), output as unknown as vscode.OutputChannel, disconnect);
	provider.resolveWebviewView({webview: {asWebviewUri: () => '/resource', postMessage,
		onDidReceiveMessage: (handler: typeof receive) => {receive = handler; return {dispose: vi.fn()};}},
		onDidDispose: vi.fn()} as unknown as vscode.WebviewView);
	return {provider, receive: (message: HostMessage) => receive(message), postMessage, output, start, stop, disconnect};
}

it('retries the original load target after stopping the previous sequence', async () => {
	const f = fixture(); await f.receive({type: 'start', value: 'avd:Phone'});
	await f.receive({type: 'retry'});
	expect(f.stop).toHaveBeenCalledOnce(); expect(f.start.mock.calls).toEqual([['avd:Phone'], ['avd:Phone']]);
	expect(f.stop.mock.invocationCallOrder[0]).toBeLessThan(f.start.mock.invocationCallOrder[1]);
	expect(f.output.appendLine).toHaveBeenCalledWith('Retrying emulator load sequence.');
});

it('ignores stale browser failures and logs nonfatal errors using the shared notice protocol', async () => {
	const f = fixture(); f.provider.setServer('http://localhost', 'Phone');
	await f.receive({type: 'client-error', serverUrl: 'http://old', message: 'stale', fatal: true});
	expect(f.disconnect).not.toHaveBeenCalled();
	await f.receive({type: 'client-error', serverUrl: 'http://localhost', message: 'Audio failed', fatal: false});
	expect(f.output.appendLine).toHaveBeenCalledWith('Error: Audio failed');
	expect(f.postMessage).toHaveBeenCalledWith(expect.objectContaining({type: 'notice', message: 'Audio failed', level: 'error'}));
	await f.receive({type: 'client-error', serverUrl: 'http://localhost', message: 'Stream disconnected', fatal: true});
	expect(f.disconnect).toHaveBeenCalledWith('Stream disconnected');
});
