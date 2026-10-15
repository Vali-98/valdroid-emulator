import { beforeEach, expect, it, vi } from 'vitest';
import type { DropEvent } from 'react-dropzone';
import { fromEvent } from 'file-selector';
import { filesFromEvent } from '../../src/webview/files';
import { deferred } from '../helpers';

vi.mock('file-selector', () => ({ fromEvent: vi.fn() }));
beforeEach(() => { vi.mocked(fromEvent).mockReset(); });
const event = (files: File[], type = 'drop') => ({ type, dataTransfer: { files } }) as unknown as DropEvent;

it('delegates hover metadata and successful file/directory extraction to the library', async () => {
	const file = new File(['ok'], 'file.txt'); vi.mocked(fromEvent).mockResolvedValue([file]);
	expect(await filesFromEvent(event([], 'dragenter'))).toEqual([file]);
	expect(await filesFromEvent(event([]))).toEqual([file]);
});
it('falls back to native files when getFile throws', async () => {
	const file = new File(['ok'], 'file.txt');
	vi.mocked(fromEvent).mockRejectedValue(new DOMException('Failed to execute getFile on FileSystemFileHandle', 'SecurityError'));
	expect(await filesFromEvent(event([file]))).toEqual([file]);
});
it('snapshots native files before asynchronous extraction loses access', async () => {
	const file = new File(['ok'], 'file.txt'); const pending = deferred<File[]>();
	vi.mocked(fromEvent).mockReturnValue(pending.promise);
	const nativeFiles = [file]; const result = filesFromEvent(event(nativeFiles));
	nativeFiles.length = 0; pending.reject(new Error('getFile failed'));
	expect(await result).toEqual([file]);
});
it('surfaces an extraction failure if the drop has no readable fallback', async () => {
	vi.mocked(fromEvent).mockRejectedValue(new Error('not readable'));
	await expect(filesFromEvent(event([]))).rejects.toThrow('not readable');
});
it('does not replace drag-entry failures with files read outside the drop event', async () => {
	vi.mocked(fromEvent).mockRejectedValue(new Error('bad metadata'));
	await expect(filesFromEvent(event([new File([], 'a')], 'dragenter'))).rejects.toThrow('bad metadata');
});
