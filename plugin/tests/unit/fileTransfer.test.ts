import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useFileTransfer } from '../../src/webview/hooks/useFileTransfer';
import { uploadFile } from '../../src/webview/upload';
import { deferred, queryWrapper } from '../helpers';

vi.mock('../../src/webview/upload', () => ({ uploadFile: vi.fn() }));
beforeEach(() => { vi.mocked(uploadFile).mockReset(); });
const files = () => [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];

it('sends multiple files sequentially and reports final completion', async () => {
	const first = deferred<string>();
	vi.mocked(uploadFile).mockReturnValueOnce(first.promise).mockResolvedValueOnce('/sdcard/Download/b.txt');
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start(files()));
	await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
	expect(result.current.notice?.message).toBe('Sending a.txt (1/2)');
	await act(async () => first.resolve('/sdcard/Download/a.txt'));
	await waitFor(() => expect(result.current.notice?.phase).toBe('complete'));
	expect(uploadFile).toHaveBeenCalledTimes(2);
	expect(result.current.notice?.message).toBe('2 files sent to Downloads');
});
it('surfaces upload errors and allows retrying successfully', async () => {
	vi.mocked(uploadFile).mockRejectedValueOnce(new Error('ADB push failed')).mockResolvedValueOnce('/download/a');
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start(files().slice(0, 1)));
	await waitFor(() => expect(result.current.notice?.phase).toBe('error'));
	expect(result.current.notice?.message).toBe('ADB push failed'); expect(result.current.pending).toBe(false);
	act(() => result.current.start(files().slice(0, 1)));
	await waitFor(() => expect(result.current.notice?.phase).toBe('complete'));
});
it('rejects overlapping upload batches and ignores empty drops', async () => {
	const pending = deferred<string>(); vi.mocked(uploadFile).mockReturnValue(pending.promise);
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => {result.current.start([]); result.current.start(files()); result.current.start(files());});
	await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
	await act(async () => pending.reject(new Error('test finished')));
});
it('aborts an in-flight transfer when its workspace unmounts', async () => {
	const pending = deferred<string>(); vi.mocked(uploadFile).mockReturnValue(pending.promise);
	const { result, unmount } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start(files()));
	await waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
	const signal = vi.mocked(uploadFile).mock.calls[0][1];
	unmount(); expect(signal.aborted).toBe(true); pending.reject(new Error('Upload canceled'));
});
it('updates progress and dismisses completed notices', async () => {
	const pending = deferred<string>(); vi.mocked(uploadFile).mockReturnValue(pending.promise);
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start(files().slice(0, 1)));
	await waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
	act(() => vi.mocked(uploadFile).mock.calls[0][2](42)); expect(result.current.notice?.progress).toBe(42);
	await act(async () => pending.resolve('/download/a'));
	await waitFor(() => expect(result.current.notice?.phase).toBe('complete'));
	act(() => result.current.dismiss()); expect(result.current.notice).toBeUndefined();
});
