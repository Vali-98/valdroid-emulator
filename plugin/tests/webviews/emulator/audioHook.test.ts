import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAudio } from '../../../src/webviews/emulator/hooks/useAudio';

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), query: vi.fn(), start: vi.fn(), resume: vi.fn(), close: vi.fn() }));
vi.mock('../../../src/webviews/emulator/api', () => ({ useDeviceQuery: mocks.query }));
vi.mock('../../../src/webviews/emulator/media/audio', () => ({ startAudio: mocks.start }));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.query.mockReturnValue({ data: undefined, dataUpdatedAt: 0, refetch: mocks.refetch });
	mocks.start.mockReturnValue({ stop: vi.fn(), setVolume: vi.fn(), updateServerStatus: vi.fn() });
	mocks.close.mockResolvedValue(undefined);
	vi.stubGlobal('AudioContext', class {
		state = 'running';
		resume = mocks.resume;
		close = mocks.close;
	});
});

it('does not resume running audio for every repeated control interaction', () => {
	const { result, unmount } = renderHook(() => useAudio('http://localhost'));
	act(() => {for (let i = 0; i < 1000; i++) {result.current.resume();}});
	expect(mocks.resume).not.toHaveBeenCalled();
	expect(mocks.start).toHaveBeenCalledTimes(1);
	unmount();
	expect(mocks.close).toHaveBeenCalledTimes(1);
});

it('polls volume less often and preserves in-flight reads when a button requests refresh', () => {
	const { result } = renderHook(() => useAudio('http://localhost'));
	expect(mocks.query).toHaveBeenCalledWith('http://localhost', '/api/volume', 10000);
	act(() => {result.current.refreshVolume();});
	expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false });
});
