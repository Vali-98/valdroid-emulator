import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useHostSession } from '../../../src/webviews/emulator/hooks/useHostSession';

const bridge = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock('../../../src/webviews/shared/vscode', () => ({ vscode: bridge }));
beforeEach(() => { bridge.postMessage.mockClear(); });
const receive = (data: object) => act(() => {window.dispatchEvent(new MessageEvent('message', { data }));});

it('announces readiness and removes its listener on unmount', () => {
	const remove = vi.spyOn(window, 'removeEventListener');
	const { unmount } = renderHook(useHostSession);
	expect(bridge.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	unmount(); expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
});
it('preserves selection on refresh and falls back when a device disappears', () => {
	const { result } = renderHook(useHostSession);
	const targets = [{ label: 'A', value: 'avd:a' }, { label: 'B', value: 'avd:b' }];
	receive({ type: 'targets', targets });
	act(() => result.current.selectTarget('avd:b'));
	receive({ type: 'targets', targets }); expect(result.current.selectedTarget).toBe('avd:b');
	receive({ type: 'targets', targets: [targets[0]] }); expect(result.current.selectedTarget).toBe('avd:a');
	receive({ type: 'targets', targets: [] }); expect(result.current.selectedTarget).toBe('');
});
it('updates status, server, and name atomically and clears the connection on idle', () => {
	const { result } = renderHook(useHostSession);
	receive({ type: 'status', state: 'online', status: 'Connected', serverUrl: 'http://127.0.0.1:8080', deviceName: 'Phone' });
	expect(result.current.session.deviceName).toBe('Phone');
	receive({ type: 'status', state: 'idle', status: 'Stopped' });
	expect(result.current.session.serverUrl).toBeUndefined();
});

it('follows the selected AVD when it becomes a running device during refresh', () => {
	const {result} = renderHook(useHostSession);
	receive({type: 'targets', targets: [{label: 'Phone', value: 'avd:Phone', avdName: 'Phone'}]});
	receive({type: 'targets', targets: [
		{label: 'Other', value: 'device:emulator-5554', avdName: 'Other'},
		{label: 'Phone', value: 'device:emulator-5556', avdName: 'Phone'},
	]});
	expect(result.current.selectedTarget).toBe('device:emulator-5556');
	receive({type: 'targets', targets: [
		{label: 'Other', value: 'avd:Other', avdName: 'Other'},
		{label: 'Phone', value: 'avd:Phone', avdName: 'Phone'},
	]});
	expect(result.current.selectedTarget).toBe('avd:Phone');
});

it('restores and saves the workspace Expo preference without resetting during launch', () => {
	const {result} = renderHook(useHostSession);
	receive({type: 'expo-preference', enabled: true});
	receive({type: 'status', state: 'online', status: 'Starting', serverUrl: 'http://localhost'});
	receive({type: 'status', state: 'idle', status: 'Stopped'});
	expect(result.current.launchWithExpo).toBe(true);
	act(() => result.current.setLaunchWithExpo(false));
	expect(bridge.postMessage).toHaveBeenLastCalledWith({type: 'expo-preference', enabled: false});
	expect(result.current.launchWithExpo).toBe(false);
});

it('shows Expo loading immediately and keeps it active when streaming is already connected', () => {
	const {result} = renderHook(useHostSession);
	act(() => result.current.selectTarget('avd:Phone'));
	act(() => result.current.startExpo());
	expect(result.current.launch.busy).toBe(true);
	receive({type: 'status', state: 'online', status: 'Connected', serverUrl: 'http://localhost'});
	receive({type: 'launch-progress', busy: true, status: 'Building app…'});
	expect(result.current.launch).toMatchObject({busy: true, status: 'Building app…'});
	receive({type: 'launch-progress', busy: false, status: ''});
	expect(result.current.launch.busy).toBe(false);
});

it('keeps a disconnect notice after returning to the picker and sends load retries', () => {
	const {result} = renderHook(useHostSession);
	receive({type: 'status', state: 'online', status: 'Connected', serverUrl: 'http://localhost'});
	receive({type: 'notice', id: 1, message: 'Device disconnected', level: 'error'});
	receive({type: 'status', state: 'idle', status: 'Select an emulator'});
	expect(result.current.session.serverUrl).toBeUndefined(); expect(result.current.notice?.message).toBe('Device disconnected');
	act(() => result.current.retry()); expect(bridge.postMessage).toHaveBeenLastCalledWith({type: 'retry'});
	act(() => result.current.dismissNotice()); expect(result.current.notice).toBeUndefined();
});
