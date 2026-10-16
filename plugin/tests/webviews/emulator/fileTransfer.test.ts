import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useFileTransfer } from '../../../src/webviews/emulator/hooks/useFileTransfer';
import { uploadFile } from '../../../src/webviews/emulator/transfers/upload';
import { deferred, queryWrapper } from '../../helpers';
import type { FileTransferResult } from '../../../src/shared/protocol';

vi.mock('../../../src/webviews/emulator/transfers/upload', () => ({ uploadFile: vi.fn() }));
beforeEach(() => { vi.mocked(uploadFile).mockReset(); });
const files = () => [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
const download = (path: string): FileTransferResult => ({ kind: 'download', path });

it('sends multiple files sequentially and reports final completion', async () => {
	const first = deferred<FileTransferResult>();
	vi.mocked(uploadFile).mockReturnValueOnce(first.promise).mockResolvedValueOnce(download('/sdcard/Download/b.txt'));
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start(files()));
	await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
	expect(result.current.notice?.message).toBe('Sending a.txt (1/2)');
	await act(async () => first.resolve(download('/sdcard/Download/a.txt')));
	await waitFor(() => expect(result.current.notice?.phase).toBe('complete'));
	expect(uploadFile).toHaveBeenCalledTimes(2);
	expect(result.current.notice?.message).toBe('2 files sent to Downloads');
});
it('surfaces upload errors and allows retrying successfully', async () => {
	vi.mocked(uploadFile).mockRejectedValueOnce(new Error('ADB push failed')).mockResolvedValueOnce(download('/download/a'));
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start(files().slice(0, 1)));
	await waitFor(() => expect(result.current.notice?.phase).toBe('error'));
	expect(result.current.notice?.message).toBe('ADB push failed'); expect(result.current.pending).toBe(false);
	act(() => result.current.start(files().slice(0, 1)));
	await waitFor(() => expect(result.current.notice?.phase).toBe('complete'));
});
it('rejects overlapping upload batches and ignores empty drops', async () => {
	const pending = deferred<FileTransferResult>(); vi.mocked(uploadFile).mockReturnValue(pending.promise);
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => {result.current.start([]); result.current.start(files()); result.current.start(files());});
	await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
	await act(async () => pending.reject(new Error('test finished')));
});
it('aborts an in-flight transfer when its workspace unmounts', async () => {
	const pending = deferred<FileTransferResult>(); vi.mocked(uploadFile).mockReturnValue(pending.promise);
	const { result, unmount } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start(files()));
	await waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
	const signal = vi.mocked(uploadFile).mock.calls[0][1];
	unmount(); expect(signal.aborted).toBe(true); pending.reject(new Error('Upload canceled'));
});
it('updates progress and dismisses completed notices', async () => {
	const pending = deferred<FileTransferResult>(); vi.mocked(uploadFile).mockReturnValue(pending.promise);
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start(files().slice(0, 1)));
	await waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
	act(() => vi.mocked(uploadFile).mock.calls[0][2](42)); expect(result.current.notice?.progress).toBe(42);
	await act(async () => pending.resolve(download('/download/a')));
	await waitFor(() => expect(result.current.notice?.phase).toBe('complete'));
	act(() => result.current.dismiss()); expect(result.current.notice).toBeUndefined();
});

it('shows APK installation progress and confirmed completion', async () => {
	const pending = deferred<FileTransferResult>(); vi.mocked(uploadFile).mockReturnValue(pending.promise);
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start([new File(['apk'], 'App.APK')]));
	await waitFor(() => expect(result.current.notice?.message).toBe('Installing App.APK'));
	await act(async () => pending.resolve({ kind: 'installed' }));
	await waitFor(() => expect(result.current.notice?.message).toBe('App.APK installed'));
});

it('summarizes mixed APK and Downloads batches accurately', async () => {
	vi.mocked(uploadFile).mockResolvedValueOnce({ kind: 'installed' }).mockResolvedValueOnce(download('/download/b.txt'));
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	act(() => result.current.start([new File(['apk'], 'app.apk'), new File(['b'], 'b.txt')]));
	await waitFor(() => expect(result.current.notice?.message).toBe('1 APK installed; 1 file sent to Downloads'));
});

it('surfaces install failures and accepts a subsequent APK', async () => {
	vi.mocked(uploadFile).mockRejectedValueOnce(new Error('INSTALL_FAILED_UPDATE_INCOMPATIBLE')).mockResolvedValueOnce({ kind: 'installed' });
	const { result } = renderHook(() => useFileTransfer(), { wrapper: queryWrapper() });
	const apk = new File(['apk'], 'app.apk');
	act(() => result.current.start([apk]));
	await waitFor(() => expect(result.current.notice?.message).toBe('INSTALL_FAILED_UPDATE_INCOMPATIBLE'));
	act(() => result.current.start([apk]));
	await waitFor(() => expect(result.current.notice?.message).toBe('app.apk installed'));
});
