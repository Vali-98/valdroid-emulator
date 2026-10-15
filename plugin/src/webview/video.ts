import { socketUrl } from './api';
import { setPresentedDisplay } from './input';
import type { DisplayState } from '../shared/protocol';

export function decodeVideoFrame(buffer: ArrayBuffer): { jpeg: Blob; display: DisplayState } {
	const data = new DataView(buffer);
	if (buffer.byteLength < 42 || data.getUint32(0) !== 0x56444a50 || data.getUint16(40) !== 0xffd8) {
		throw new Error('Invalid video frame');
	}
	const display = { id: data.getInt32(4, true), width: data.getUint32(8, true), height: data.getUint32(12, true), orientation: data.getUint32(16, true) };
	if (!display.width || !display.height || display.width > 16384 || display.height > 16384 || display.orientation > 3) {
		throw new Error('Invalid video dimensions');
	}
	return { jpeg: new Blob([new Uint8Array(buffer, 40)], { type: 'image/jpeg' }), display };
}

export function startVideo(serverUrl: string, image: HTMLCanvasElement): () => void {
	const context = image.getContext('2d', { alpha: false });
	if (!context) {return () => undefined;}
	let socket: WebSocket;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let pending: ArrayBuffer | undefined;
	let decoding = false;
	let disposed = false;
	let fallback: HTMLImageElement | undefined;
	let fallbackPaint = 0;
	const draw = (bitmap: CanvasImageSource & { width: number; height: number }) => {
		if (image.width !== bitmap.width || image.height !== bitmap.height) {image.width = bitmap.width; image.height = bitmap.height;}
		context.drawImage(bitmap, 0, 0);
	};
	const stopFallback = () => {cancelAnimationFrame(fallbackPaint); if (fallback) {fallback.removeAttribute('src'); fallback = undefined;}};
	const present = async () => {
		if (decoding || disposed || !pending) {return;}
		decoding = true;
		const buffer = pending; pending = undefined;
		let bitmap: ImageBitmap | undefined;
		try {
			const frame = decodeVideoFrame(buffer);
			bitmap = await createImageBitmap(frame.jpeg);
			if (disposed) {return;}
			stopFallback();
			draw(bitmap);
			setPresentedDisplay(image, frame.display);
		} catch {
			// A malformed/interrupted frame must not stop later frames from rendering.
		} finally {
			bitmap?.close();
			decoding = false;
			void present();
		}
	};
	const connect = () => {
		if (disposed) {return;}
		socket = new WebSocket(socketUrl(serverUrl, '/video'));
		socket.binaryType = 'arraybuffer';
		socket.onmessage = event => {
			if (event.data instanceof ArrayBuffer && !disposed) {pending = event.data; void present();}
		};
		socket.onerror = () => socket.close();
		socket.onclose = () => {
			if (disposed) {return;}
			if (!image.width && !fallback) {
				fallback = new Image(); fallback.src = `${serverUrl}/stream`;
				const paint = () => {
					if (disposed || !fallback) {return;}
					if (fallback.naturalWidth) {draw(fallback);}
					fallbackPaint = requestAnimationFrame(paint);
				};
				fallbackPaint = requestAnimationFrame(paint);
			}
			retry = setTimeout(connect, 1000);
		};
	};
	connect();
	return () => {
		disposed = true; pending = undefined;
		clearTimeout(retry);
		socket.onmessage = socket.onclose = socket.onerror = null; socket.close();
		stopFallback();
		setPresentedDisplay(image);
		image.width = image.height = 0;
	};
}
