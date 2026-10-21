import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useDeviceQuery } from '../../../src/webviews/emulator/api';
import { queryWrapper } from '../../helpers';

it('does not fetch without a device URL', () => {
	const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
	renderHook(() => useDeviceQuery('', '/api/volume', 1000), { wrapper: queryWrapper() });
	expect(fetch).not.toHaveBeenCalled();
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
