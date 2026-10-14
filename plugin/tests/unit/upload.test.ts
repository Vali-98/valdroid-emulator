import { beforeEach, expect, it, vi } from 'vitest';
import { uploadFile } from '../../src/webview/upload';

class Request {
	static latest: Request;
	status = 200; responseText = '{"path":"/sdcard/Download/file.txt"}';
	open = vi.fn(); setRequestHeader = vi.fn(); send = vi.fn();
	onload?: () => void; onerror?: () => void; onabort?: () => void;
	upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
	abort = vi.fn(() => this.onabort?.());
	constructor() {Request.latest = this;}
}
beforeEach(() => vi.stubGlobal('XMLHttpRequest', Request));
const start = (controller = new AbortController()) => {
	const progress = vi.fn(); const promise = uploadFile('http://localhost', new File(['ok'], 'a b.txt'), controller.signal, progress);
	return { promise, progress, request: Request.latest, controller };
};

it('encodes filenames, streams the File body, and reads the device path', async () => {
	const { promise, progress, request } = start();
	expect(request.open).toHaveBeenCalledWith('POST', 'http://localhost/api/upload?name=a%20b.txt');
	expect(request.send.mock.calls[0][0]).toBeInstanceOf(File);
	request.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }); expect(progress).toHaveBeenCalledWith(50);
	request.onload?.(); await expect(promise).resolves.toBe('/sdcard/Download/file.txt');
});
it('reports HTTP errors from the control server', async () => {
	const { promise, request } = start(); request.status = 502; request.responseText = 'could not send file to device';
	request.onload?.(); await expect(promise).rejects.toThrow('could not send file to device');
});
it('rejects invalid server responses', async () => {
	const { promise, request } = start(); request.responseText = 'not json'; request.onload?.();
	await expect(promise).rejects.toThrow('Invalid upload response');
});
it('reports a disconnected server', async () => {
	const { promise, request } = start(); request.onerror?.();
	await expect(promise).rejects.toThrow('Could not reach the device server');
});
it('aborts in flight and removes the abort listener after completion', async () => {
	const active = start(); active.controller.abort(); await expect(active.promise).rejects.toThrow('Upload canceled');
	const completed = start(); completed.request.onload?.(); await completed.promise;
	completed.controller.abort(); expect(completed.request.abort).not.toHaveBeenCalled();
});
