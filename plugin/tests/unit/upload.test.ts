import { beforeEach, expect, it, vi } from 'vitest';
import { uploadFile } from '../../src/webview/upload';
import { vscode } from '../../src/webview/vscode';
import { uploadChunkSize, type HostMessage, type UploadRequest } from '../../src/shared/protocol';

vi.mock('../../src/webview/vscode', () => ({ vscode: { postMessage: vi.fn() } }));
function reply(message: HostMessage, extra: { path?: string; error?: string } = {}) {
	const request = message as UploadRequest;
	window.dispatchEvent(new MessageEvent('message', { data: { type: 'upload-result', id: request.id, requestId: request.requestId, ...extra } }));
}
beforeEach(() => {
	vi.mocked(vscode.postMessage).mockReset().mockImplementation(message => {
		if (message.type === 'upload-finish') { reply(message, { path: '/sdcard/Download/a b.txt' }); }
		else { reply(message); }
	});
});

it('sends chunked file bytes over the extension bridge and reads the ADB destination', async () => {
	const file = new File([new Uint8Array(uploadChunkSize+1)], 'a b.txt');
	const progress = vi.fn();
	await expect(uploadFile(file, new AbortController().signal, progress)).resolves.toBe('/sdcard/Download/a b.txt');
	const calls = vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message);
	expect(calls.map(message => message.type)).toEqual(['upload-start', 'upload-chunk', 'upload-chunk', 'upload-finish']);
	expect(calls[0]).toMatchObject({ name: 'a b.txt', size: uploadChunkSize+1 });
	expect(calls[2]).toMatchObject({ offset: uploadChunkSize, data: 'AA==' });
	expect(progress).toHaveBeenLastCalledWith(100);
});
it('reports ADB errors and cancels the staged transfer', async () => {
	vi.mocked(vscode.postMessage).mockImplementation(message => reply(message, { error: 'ADB push failed' }));
	await expect(uploadFile(new File(['ok'], 'file.txt'), new AbortController().signal, vi.fn())).rejects.toThrow('ADB push failed');
	expect(vscode.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'upload-cancel' }));
});
it('rejects a finish reply without a destination', async () => {
	vi.mocked(vscode.postMessage).mockImplementation(message => reply(message));
	await expect(uploadFile(new File([], 'empty.txt'), new AbortController().signal, vi.fn())).rejects.toThrow('did not confirm a destination');
});
it('aborts pending bridge requests and removes listeners after completion', async () => {
	vi.mocked(vscode.postMessage).mockImplementation(() => undefined);
	const controller = new AbortController();
	const pending = uploadFile(new File(['ok'], 'file.txt'), controller.signal, vi.fn());
	controller.abort(); await expect(pending).rejects.toThrow('Upload canceled');
	const calls = vi.mocked(vscode.postMessage).mock.calls.length;
	controller.abort(); expect(vscode.postMessage).toHaveBeenCalledTimes(calls);
});
it('forwards host progress only for the current transfer', async () => {
	vi.mocked(vscode.postMessage).mockImplementation(message => {
		if (message.type === 'upload-finish') {
			window.dispatchEvent(new MessageEvent('message', { data: { type: 'upload-progress', id: message.id, percent: 42 } }));
			reply(message, { path: '/sdcard/Download/file.txt' });
		} else { reply(message); }
	});
	const progress = vi.fn();
	await uploadFile(new File([], 'file.txt'), new AbortController().signal, progress);
	expect(progress.mock.calls).toEqual([[42], [100]]);
});
