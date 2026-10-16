import { socketUrl } from '../api';
import { setPresentedDisplay } from '../input/input';
import type { DisplayState } from '../../../shared/protocol';

export type VideoStats = { decoded: number; presented: number; replaced: number; fps: number; ageMeanMs: number; ageP95Ms: number; queue: number };

export function parseAVCPacket(data: ArrayBuffer) {
	if (data.byteLength <= 36) {throw new Error('Truncated AVC packet');}
	const header = new DataView(data);
	if (header.getUint32(0) !== 0x56444156 || header.getUint8(4) > 1) {throw new Error('Invalid AVC packet');}
	return { key: header.getUint8(4) === 1, timestamp: Number(header.getBigUint64(8, true)),
		receivedAt: Number(header.getBigUint64(16, true)), data: new Uint8Array(data, 32) };
}

// No media clock or encoded-frame dropping: decode every reference, then present
// only the newest decoded frame at the next paint. Memory and pending work bounded.
export function startAVCVideo(serverUrl: string, canvas: HTMLCanvasElement, report: (status: string) => void, onError: (reason: string) => void, onStats?: (stats: VideoStats | undefined) => void): () => void {
	let disposed = false;
	let socket: WebSocket | undefined;
	let decoder: VideoDecoder | undefined;
	let generation = 0;
	let ready = false;
	let waitingKey = true;
	let queued: ArrayBuffer[] = [];
	let pending: { frame: VideoFrame; receivedAt: number; display: DisplayState } | undefined;
	let paint = 0;
	let timer: ReturnType<typeof setInterval> | undefined;
	let display: DisplayState;
	const receipts = new Map<number, number>();
	const ages: number[] = [];
	let decoded = 0, presented = 0, replaced = 0, lastPresented = 0;
	let lastTick = performance.now();
	const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
	const stop = () => {
		if (disposed) {return;}
		disposed = true; generation++;
		clearInterval(timer); cancelAnimationFrame(paint);
		pending?.frame.close(); pending = undefined; queued = []; receipts.clear();
		if (decoder?.state !== 'closed') {decoder?.close();}
		if (socket) {socket.onmessage = socket.onerror = socket.onclose = null; socket.close();}
		setPresentedDisplay(canvas);
		delete canvas.dataset.avcProfile;
	};
	const fail = (reason: string) => {if (!disposed) {stop(); onStats?.(undefined); onError(reason);}};
	if (typeof VideoDecoder === 'undefined' || !context) {
		queueMicrotask(() => fail('WebCodecs or canvas unavailable'));
		return stop;
	}
	const draw = () => {
		paint = 0;
		const next = pending; pending = undefined;
		if (!next) {return;}
		try {
			if (canvas.width !== next.frame.displayWidth || canvas.height !== next.frame.displayHeight) {
				canvas.width = next.frame.displayWidth; canvas.height = next.frame.displayHeight;
			}
			context.drawImage(next.frame, 0, 0);
			setPresentedDisplay(canvas, next.display); presented++;
			ages.push(Date.now() - next.receivedAt);
			if (ages.length > 600) {ages.shift();}
		} catch (error) {fail(`Canvas presentation failed: ${String(error)}`);} finally {next.frame.close();}
	};
	const decode = (buffer: ArrayBuffer) => {
		const packet = parseAVCPacket(buffer);
		if (waitingKey && !packet.key) {return;}
		if (!decoder || decoder.state !== 'configured') {return;}
		if (decoder.decodeQueueSize >= 12 || receipts.size >= 24) {
			fail('AVC decoder cannot keep up; restart playback'); return;
		}
		if (waitingKey) {report('Playing');}
		waitingKey = false;
		receipts.set(packet.timestamp, packet.receivedAt);
		decoder.decode(new EncodedVideoChunk({ type: packet.key ? 'key' : 'delta', timestamp: packet.timestamp, data: packet.data }));
	};
	const configure = async (codec: string, nextDisplay: DisplayState) => {
		const current = ++generation;
		ready = false; waitingKey = true; queued = []; receipts.clear();
		onStats?.(undefined); delete canvas.dataset.avcProfile;
		pending?.frame.close(); pending = undefined;
		if (decoder?.state !== 'closed') {decoder?.close();}
		const config: VideoDecoderConfig = { codec, optimizeForLatency: true };
		const support = await VideoDecoder.isConfigSupported(config);
		if (disposed || current !== generation) {return;}
		if (!support.supported) {fail(`WebCodecs does not support ${codec}`); return;}
		display = nextDisplay;
		decoder = new VideoDecoder({
			error: error => {if (current === generation) {fail(`AVC decode failed: ${error.message}`);}},
			output: frame => {
				if (disposed || current !== generation) {frame.close(); return;}
				const receivedAt = receipts.get(frame.timestamp); receipts.delete(frame.timestamp); decoded++;
				if (receivedAt === undefined) {frame.close(); return;}
				if (pending) {pending.frame.close(); replaced++;}
				pending = { frame, receivedAt, display };
				if (!paint) {paint = requestAnimationFrame(draw);}
			},
		});
		decoder.configure(config); ready = true;
		report('Waiting for keyframe…');
		const packets = queued; queued = [];
		for (const packet of packets) {if (!disposed) {decode(packet);}}
	};
	report('Connecting…');
	socket = new WebSocket(socketUrl(serverUrl, '/avc')); socket.binaryType = 'arraybuffer';
	socket.onmessage = event => {
		try {
			if (typeof event.data === 'string') {
				const config = JSON.parse(event.data);
				if (config.type !== 'config' || typeof config.codec !== 'string' || !config.display?.width || !config.display?.height) {throw new Error('Invalid AVC config');}
				void configure(config.codec, config.display).catch(error => fail(String(error)));
			} else if (event.data instanceof ArrayBuffer) {
				if (ready) {decode(event.data);} else if (queued.length < 8) {queued.push(event.data);} else {fail('AVC configuration backlog');}
			}
		} catch (error) {fail(`AVC stream error: ${String(error)}`);}
	};
	socket.onerror = () => fail('Direct AVC connection failed');
	socket.onclose = () => fail('Direct AVC stream disconnected');
	timer = setInterval(() => {
		if (!presented) {return;}
		const now = performance.now();
		const sorted = [...ages].sort((a,b) => a-b);
		const p95 = sorted[Math.max(0, Math.ceil(sorted.length * .95)-1)] ?? 0;
		const mean = ages.reduce((a,b) => a+b, 0) / Math.max(1, ages.length);
		const stats = { decoded, presented, replaced, fps: (presented-lastPresented)*1000/(now-lastTick), ageMeanMs: mean, ageP95Ms: p95, queue: decoder?.decodeQueueSize ?? 0 };
		canvas.dataset.avcProfile = JSON.stringify(stats);
		onStats?.(stats);
		lastPresented = presented; lastTick = now;
	}, 1000);
	return stop;
}
