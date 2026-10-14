import { maxUploadSize, uploadChunkSize, type ExtensionMessage, type UploadCommand, type UploadReply } from '../shared/protocol';
import { vscode } from './vscode';

function readChunk(blob: Blob, signal: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		const abort = () => {reader.abort(); reject(new Error('Upload canceled'));};
		const finish = () => signal.removeEventListener('abort', abort);
		reader.onload = () => {finish(); resolve(String(reader.result).split(',')[1]);};
		reader.onerror = () => {finish(); reject(reader.error ?? new Error('Could not read dropped file'));};
		reader.onabort = () => {finish(); reject(new Error('Upload canceled'));};
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {abort(); finish(); return;}
		reader.readAsDataURL(blob);
	});
}

export async function uploadFile(file: File, signal: AbortSignal, onProgress: (percent: number) => void): Promise<string> {
	if (signal.aborted) {throw new Error('Upload canceled');}
	if (file.size > maxUploadSize) {throw new Error('File exceeds the 4 GiB upload limit');}
	const id = crypto.randomUUID();
	let pending: { requestId: string; resolve: (reply: UploadReply) => void; reject: (error: Error) => void; timer: number } | undefined;
	const receive = (event: MessageEvent<ExtensionMessage>) => {
		const message = event.data;
		if (message?.type === 'upload-progress' && message.id === id) {onProgress(message.percent);}
		if (message?.type !== 'upload-result' || message.id !== id || message.requestId !== pending?.requestId) {return;}
		const request = pending;
		pending = undefined;
		window.clearTimeout(request.timer);
		if (message.error) {request.reject(new Error(message.error));}
		else {request.resolve(message);}
	};
	const abort = () => {
		if (pending) {window.clearTimeout(pending.timer); pending.reject(new Error('Upload canceled')); pending = undefined;}
	};
	const request = (command: UploadCommand, timeout = 30000): Promise<UploadReply> => new Promise((resolve, reject) => {
		if (signal.aborted) {reject(new Error('Upload canceled')); return;}
		const requestId = crypto.randomUUID();
		const timer = window.setTimeout(() => {pending = undefined; reject(new Error('The extension did not respond to the file transfer'));}, timeout);
		pending = { requestId, resolve, reject, timer };
		try {vscode.postMessage({ ...command, requestId });}
		catch (error) {pending = undefined; window.clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error)));}
	});
	window.addEventListener('message', receive);
	signal.addEventListener('abort', abort, { once: true });
	try {
		await request({ type: 'upload-start', id, name: file.name, size: file.size });
		for (let offset = 0; offset < file.size; offset += uploadChunkSize) {
			const data = await readChunk(file.slice(offset, offset + uploadChunkSize), signal);
			await request({ type: 'upload-chunk', id, offset, data });
		}
		const result = await request({ type: 'upload-finish', id }, 16 * 60 * 1000);
		if (!result.path) {throw new Error('The extension did not confirm a destination on the device');}
		onProgress(100);
		return result.path;
	} catch (error) {
		vscode.postMessage({ type: 'upload-cancel', id, requestId: crypto.randomUUID() });
		throw error;
	} finally {
		window.removeEventListener('message', receive);
		signal.removeEventListener('abort', abort);
		if (pending) {window.clearTimeout(pending.timer);}
	}
}
