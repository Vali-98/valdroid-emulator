import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { socketUrl, useDeviceQuery } from '../../../src/webviews/emulator/api';
import { queryWrapper } from '../../helpers';

it('converts both HTTP and HTTPS socket URLs', () => {
	expect(socketUrl('http://localhost:8080', '/audio')).toBe('ws://localhost:8080/audio');
	expect(socketUrl('https://localhost:8080', '/control')).toBe('wss://localhost:8080/control');
});
it('does not fetch without a device URL', () => {
	const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
	renderHook(() => useDeviceQuery('', '/api/volume', 1000), { wrapper: queryWrapper() });
	expect(fetch).not.toHaveBeenCalled();
});
it('loads device data through a cancellable request', async () => {
	const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ current: 5 }) }); vi.stubGlobal('fetch', fetch);
	const { result } = renderHook(() => useDeviceQuery('http://localhost', '/api/volume', 1000), { wrapper: queryWrapper() });
	await waitFor(() => expect(result.current.data).toEqual({ current: 5 }));
	expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it('aborts obsolete requests on a server change and unmount', () => {
	const signals: AbortSignal[] = [];
	vi.stubGlobal('fetch', vi.fn((_url, options) => {signals.push(options.signal); return new Promise(() => {});}));
	const { rerender, unmount } = renderHook(({ url }) => useDeviceQuery(url, '/api/volume', 1000), {
		initialProps: { url: 'http://one' }, wrapper: queryWrapper(),
	});
	rerender({ url: 'http://two' }); expect(signals[0].aborted).toBe(true);
	unmount(); expect(signals[1].aborted).toBe(true);
});
it('reports HTTP errors instead of caching invalid data', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
	const { result } = renderHook(() => useDeviceQuery('http://localhost', '/api/volume', 1000), { wrapper: queryWrapper() });
	await waitFor(() => expect(result.current.error?.message).toBe('/api/volume: 503'));
	expect(result.current.data).toBeUndefined();
});
