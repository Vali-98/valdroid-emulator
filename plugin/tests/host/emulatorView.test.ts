// @vitest-environment node
import type * as vscode from 'vscode';
import { expect, it, vi } from 'vitest';
import { EmulatorViewProvider } from '../../src/host/views/EmulatorViewProvider';
import type { HostMessage } from '../../src/shared/protocol';

vi.mock('vscode', () => ({Uri: {joinPath: () => '/resource'}, commands: {executeCommand: vi.fn()}}));

function fixture(expoStart?: () => Promise<void>) {
	let receive!: (message: HostMessage) => Promise<void>;
	const postMessage = vi.fn(); const output = {appendLine: vi.fn()};
	const start = vi.fn(async (_value: string) => undefined), stop = vi.fn(async () => undefined), disconnect = vi.fn(async (_reason: string) => undefined);
	const provider = new EmulatorViewProvider({extensionUri: '/extension'} as unknown as vscode.ExtensionContext,
		async () => [], start, stop, () => undefined, vi.fn(), output as unknown as vscode.OutputChannel, disconnect,
		expoStart ? {start: expoStart, toggle: vi.fn(), state: () => ({active: true, enabled: false, connected: false})} : undefined);
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

it('tracks Expo startup separately from the emulator stream until the build promise settles', async () => {
	let finish!: () => void;
	const f = fixture(() => new Promise<void>(resolve => {finish = resolve;}));
	const starting = f.receive({type: 'start-expo', value: 'avd:Phone'});
	expect(f.postMessage).toHaveBeenCalledWith(expect.objectContaining({type: 'launch-progress', busy: true}));
	f.provider.setServer('http://localhost', 'Phone');
	f.provider.setStatus('Connected', 'online');
	expect(f.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({type: 'launch-progress', busy: false}));
	finish(); await starting;
	expect(f.postMessage).toHaveBeenCalledWith(expect.objectContaining({type: 'launch-progress', busy: false}));
});

it('keeps shutdown loading active while stopping and clears it after teardown', async () => {
	const f = fixture();
	let finish!: () => void;
	f.stop.mockImplementationOnce(() => new Promise<undefined>(resolve => {finish = () => resolve(undefined);}));
	const closing = f.receive({type: 'close'});
	await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce());
	expect(f.postMessage).toHaveBeenCalledWith({type: 'launch-progress', busy: true, status: 'Shutting down…'});
	f.provider.setServer(undefined);
	expect(f.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({type: 'launch-progress', busy: false}));
	finish(); await closing;
	expect(f.postMessage).toHaveBeenCalledWith({type: 'launch-progress', busy: false, status: ''});
});
