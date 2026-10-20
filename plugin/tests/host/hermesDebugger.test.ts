// @vitest-environment node
import {beforeEach, expect, it, vi} from 'vitest';
import {hermesDebugConfiguration, parseHermesTargets} from '../../src/host/reactNative/hermesTarget';
import {HermesDebugger} from '../../src/host/reactNative/HermesDebugger';
vi.mock('../../src/host/reactNative/InspectorTransport', () => ({createInspectorTransport: vi.fn(async () => ({websocket: 'ws://127.0.0.1:9999/test-transport', close: vi.fn()}))}));

const mock = vi.hoisted(() => ({start: vi.fn(), stop: vi.fn(), pick: vi.fn(), started: undefined as undefined | ((session: any) => void), terminated: undefined as undefined | ((session: any) => void), tracker: undefined as any}));
vi.mock('vscode', () => ({
	workspace: {isTrusted: true, getWorkspaceFolder: vi.fn()}, Uri: {file: (file: string) => file},
	commands: {executeCommand: vi.fn()},
	window: {showQuickPick: mock.pick},
	debug: {
		startDebugging: mock.start, stopDebugging: mock.stop,
		onDidStartDebugSession: (fn: any) => {mock.started = fn; return {dispose() {}};},
		onDidTerminateDebugSession: (fn: any) => {mock.terminated = fn; return {dispose() {}};},
		registerDebugAdapterTrackerFactory: (_type: string, factory: any) => {mock.tracker = factory; return {dispose() {}};},
	},
}));
const page = (overrides = {}) => ({id: 'device-1', title: 'Hermes', appId: 'com.example.dev', webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?device=abc&page=1', ...overrides});
const app = {root: '/project', serial: 'emulator-5554', port: 8081, applicationId: 'com.example.dev'};
beforeEach(() => {
	mock.pick.mockReset(); mock.start.mockReset(); mock.stop.mockReset();
	vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => [page()]})));
});
it('restricts discovery to the app, owned Metro endpoint, and real runtime', () => {
	expect(parseHermesTargets([page(), page({appId: 'com.other'}), page({vm: "don't use"}), page({webSocketDebuggerUrl: 'ws://evil.example:8081/inspector/debug?device=a&page=1'}), page({webSocketDebuggerUrl: 'ws://localhost:8082/inspector/debug?device=a&page=1'})], 8081, app.applicationId)).toEqual([{id: 'device-1', title: 'Hermes', deviceName: undefined, websocket: 'ws://127.0.0.1:8081/inspector/debug?device=abc&page=1'}]);
});
it('configures direct attach without a browser, launch file, or Node child injection', () => {
	expect(hermesDebugConfiguration('/project', 'ws://localhost:8081/target', 'token')).toMatchObject({type: 'pwa-node', request: 'attach', websocketAddress: 'ws://localhost:8081/target', sourceMaps: true, autoAttachChildProcesses: false, restart: false, __valdroidDebug: 'token'});
});
it('maps Metro server source paths to project files for the owned port', () => {
	const configuration = hermesDebugConfiguration('/project', 'ws://127.0.0.1:54321/inspector/debug?device=1&page=1', 'token');
	expect(configuration.sourceMapPathOverrides['http://10.0.2.2:54321/[metro-project]/*']).toBe('/project/*');
	expect(configuration.sourceMapPathOverrides['http://127.0.0.1:54321/%5Bmetro-project%5D/*']).toBe('/project/*');
	expect(configuration.sourceMapPathOverrides['/[metro-project]/*']).toBe('/project/*');
	expect(configuration.sourceMapPathOverrides['http://localhost:8081/[metro-project]/*']).toBeUndefined();
});
it('tracks pause/continue and sends stepping only to its owned debug session', async () => {
	const changed = vi.fn();
	const bridge = new HermesDebugger(async () => app, vi.fn(), changed);
	const request = vi.fn(async () => ({threads: [{id: 1}]}));
	let session: any;
	mock.start.mockImplementation(async (_folder, configuration) => {session = {configuration, customRequest: request}; mock.started?.(session); return true;});
	await bridge.action('attach');
	expect(bridge.state.attached).toBe(true);
	expect(mock.start.mock.calls[0][2]).toEqual({suppressDebugToolbar: true, suppressDebugStatusbar: true, suppressDebugView: true});
	const tracker = mock.tracker.createDebugAdapterTracker(session);
	tracker.onDidSendMessage({type: 'event', event: 'stopped', body: {threadId: 7}});
	expect(bridge.state.paused).toBe(true);
	expect(changed).toHaveBeenCalledTimes(2);
	await bridge.action('next'); expect(request).toHaveBeenCalledWith('next', {threadId: 7});
	tracker.onDidSendMessage({type: 'event', event: 'continued'});
	expect(bridge.state.paused).toBe(false);
	expect(mock.tracker.createDebugAdapterTracker({configuration: {}})).toBeUndefined();
	await bridge.detach(); expect(mock.stop).toHaveBeenCalledWith(session);
	expect(bridge.state.attached).toBe(false); bridge.dispose();
});
it('reports missing runtime and refuses an app session that changes during discovery', async () => {
	vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => []})));
	const bridge = new HermesDebugger(async () => app, vi.fn());
	await expect(bridge.action('attach')).rejects.toThrow('No matching Hermes');
	expect(mock.start).not.toHaveBeenCalled(); bridge.dispose();
	vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => [page()]})));
	const changed = new HermesDebugger(vi.fn().mockResolvedValueOnce(app).mockResolvedValueOnce({...app, port: 9999}), vi.fn());
	await expect(changed.action('attach')).rejects.toThrow('session changed'); changed.dispose();
});
it('reports the source file and adapter reason when a breakpoint remains unbound', async () => {
	const log = vi.fn();
	const bridge = new HermesDebugger(async () => app, log);
	let session: any;
	mock.start.mockImplementation(async (_folder, configuration) => {session = {configuration}; mock.started?.(session); return true;});
	await bridge.action('attach');
	const tracker = mock.tracker.createDebugAdapterTracker(session);
	tracker.onWillReceiveMessage({type: 'request', seq: 10, command: 'setBreakpoints', arguments: {source: {path: '/project/App.tsx'}}});
	tracker.onDidSendMessage({type: 'response', request_seq: 10, command: 'setBreakpoints', success: true, body: {breakpoints: [{verified: false, line: 12, message: 'Source map not found'}]}});
	expect(log).toHaveBeenCalledWith('[Valdroid] Unbound breakpoint — /project/App.tsx: line 12: Source map not found\n');
	await bridge.detach(); bridge.dispose();
});
it('tracks a child runtime pause and sends execution controls to that child', async () => {
	const bridge = new HermesDebugger(async () => app, vi.fn());
	const rootRequest = vi.fn(), childRequest = vi.fn(async () => ({}));
	let parent: any;
	mock.start.mockImplementation(async (_folder, configuration) => {parent = {configuration, customRequest: rootRequest}; mock.started?.(parent); return true;});
	await bridge.action('attach');
	const child = {configuration: {type: 'node'}, parentSession: parent, customRequest: childRequest};
	mock.started?.(child);
	const tracker = mock.tracker.createDebugAdapterTracker(child);
	expect(tracker).toBeDefined();
	tracker.onDidSendMessage({type: 'event', event: 'stopped', body: {reason: 'breakpoint', threadId: 4}});
	expect(bridge.state.paused).toBe(true);
	await bridge.action('continue');
	expect(childRequest).toHaveBeenCalledWith('continue', {threadId: 4});
	expect(rootRequest).not.toHaveBeenCalled();
	tracker.onDidSendMessage({type: 'event', event: 'continued'});
	expect(bridge.state.paused).toBe(false);
	await bridge.detach(); bridge.dispose();
});
it('prompts rather than choosing the wrong device when runtimes are ambiguous', async () => {
	vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => [page(), page({id: 'second', deviceName: 'Other phone'})]})));
	mock.pick.mockResolvedValue(undefined);
	const bridge = new HermesDebugger(async () => app, vi.fn());
	await bridge.action('attach'); expect(mock.pick).toHaveBeenCalled(); expect(mock.start).not.toHaveBeenCalled(); bridge.dispose();
});
it('cleans up delayed debug starts canceled by stopping the Expo session', async () => {
	const bridge = new HermesDebugger(async () => app, vi.fn());
	let complete!: (value: boolean) => void;
	let configuration: any;
	mock.stop.mockResolvedValue(undefined);
	mock.start.mockImplementation((_folder, config) => {configuration = config; return new Promise<boolean>(resolve => {complete = resolve;});});
	const attaching = bridge.action('attach');
	await vi.waitFor(() => expect(mock.start).toHaveBeenCalled());
	await bridge.detach();
	const session = {configuration}; mock.started?.(session);
	expect(mock.stop).toHaveBeenCalledWith(session);
	complete(true); await attaching;
	expect(bridge.state.attached).toBe(false); bridge.dispose();
});
it('reports a disabled or unavailable JS adapter and clears busy state', async () => {
	const bridge = new HermesDebugger(async () => app, vi.fn());
	mock.start.mockResolvedValue(false);
	await expect(bridge.action('attach')).rejects.toThrow('built-in JavaScript Debugger');
	expect(bridge.state).toEqual({attached: false, paused: false, busy: false}); bridge.dispose();
});
