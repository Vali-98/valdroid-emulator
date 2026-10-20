// @vitest-environment node
import type * as vscode from 'vscode';
import {expect, it, vi} from 'vitest';
import {ConsoleViewProvider} from '../../src/host/views/ConsoleViewProvider';
import type {ConsoleRequest} from '../../src/shared/console';

vi.mock('vscode', () => ({Uri: {joinPath: () => '/resource'}}));
vi.mock('../../src/host/adb/AdbConsole', () => ({AdbConsole: class {
	selectDevice = vi.fn(async () => undefined);
	snapshot = () => ({type: 'console-snapshot', state: {streaming: false, busy: false, packages: [], processes: {}}, records: []});
	dispose = vi.fn(async () => undefined);
}}));

function fixture() {
	let receive!: (request: ConsoleRequest) => Promise<void>;
	let visibility!: () => void;
	const handlers = {active: vi.fn(), select: vi.fn(), hover: vi.fn(), refresh: vi.fn()};
	const postMessage = vi.fn();
	const provider = new ConsoleViewProvider({extensionUri: '/extension'} as unknown as vscode.ExtensionContext, 'adb');
	provider.setHierarchyHandlers(handlers);
	const view = {visible: true, webview: {asWebviewUri: () => '/resource', postMessage,
		onDidReceiveMessage: (callback: typeof receive) => {receive = callback; return {dispose() {}};}},
		onDidChangeVisibility: (callback: () => void) => {visibility = callback; return {dispose() {}};}, onDidDispose() {}};
	provider.resolveWebviewView(view as unknown as vscode.WebviewView);
	return {provider, handlers, view, postMessage, receive: (request: ConsoleRequest) => receive(request), visibility: () => visibility()};
}

it('collects hierarchy only when the tab is selected and terminal view is visible', async () => {
	const f = fixture();
	await f.receive({type: 'console-ready'});
	expect(f.handlers.active).not.toHaveBeenCalledWith(true);
	await f.receive({type: 'hierarchy-active', active: true});
	expect(f.handlers.active).toHaveBeenLastCalledWith(true);
	f.view.visible = false; f.visibility();
	expect(f.handlers.active).toHaveBeenLastCalledWith(false);
	f.view.visible = true; f.visibility();
	expect(f.handlers.active).toHaveBeenLastCalledWith(true);
	await f.receive({type: 'hierarchy-active', active: false});
	expect(f.handlers.active).toHaveBeenLastCalledWith(false);
});

it('remembers a requested component until the console is ready, and forwards validated interactions', async () => {
	const f = fixture();
	f.provider.showHierarchy('epoch:42');
	expect(f.handlers.select).toHaveBeenCalledWith('epoch:42');
	f.postMessage.mockClear();
	await f.receive({type: 'console-ready'});
	expect(f.postMessage).toHaveBeenCalledWith({type: 'hierarchy-focus', id: 'epoch:42'});
	await f.receive({type: 'hierarchy-hover', id: 'epoch:43'});
	expect(f.handlers.hover).toHaveBeenCalledWith('epoch:43');
	await f.receive({type: 'hierarchy-hover', id: '../../invalid'});
	expect(f.handlers.hover).toHaveBeenCalledOnce();
	await f.receive({type: 'hierarchy-select', id: 'epoch:43'});
	expect(f.handlers.select).toHaveBeenLastCalledWith('epoch:43');
});
