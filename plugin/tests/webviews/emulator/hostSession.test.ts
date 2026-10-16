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
it('routes start, refresh and close commands and ignores an empty selection', () => {
	const { result } = renderHook(useHostSession);
	act(() => result.current.start()); expect(bridge.postMessage).toHaveBeenCalledTimes(1);
	act(() => result.current.selectTarget('avd:a'));
	act(() => {result.current.start(); result.current.refreshTargets(); result.current.close();});
	expect(bridge.postMessage.mock.calls.slice(1)).toEqual([[{ type: 'start', value: 'avd:a' }], [{ type: 'refresh' }], [{ type: 'close' }]]);
});
it('ignores unrelated window messages', () => {
	const { result } = renderHook(useHostSession); const initial = result.current.session;
	receive({ type: 'unrelated' }); expect(result.current.session).toBe(initial);
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
