import * as React from 'react';

type AudioState = 'off' | 'on' | 'error';
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

interface AudioDecoderConfig {
	codec: string;
	sampleRate: number;
	numberOfChannels: number;
	description?: Uint8Array;
}

interface WebCodecsAudioData {
	readonly numberOfFrames: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void;
	close(): void;
}

interface WebCodecsAudioDecoder {
	readonly state: 'unconfigured' | 'configured' | 'closed';
	readonly decodeQueueSize: number;
	configure(config: AudioDecoderConfig): void;
	decode(chunk: unknown): void;
	close(): void;
}

interface AudioDecoderConstructor {
	new (init: { output: (audioData: WebCodecsAudioData) => void; error: (error: Error) => void }): WebCodecsAudioDecoder;
	isConfigSupported(config: AudioDecoderConfig): Promise<{ supported: boolean }>;
}

function playDecodedAudio(audioContext: AudioContext, playheadRef: React.MutableRefObject<number>, audioData: WebCodecsAudioData): 'muted' | 'silent' | 'audible' {
	try {
		if (audioContext.state !== 'running') {return 'muted';}
		const channels = Math.max(1, Math.min(audioData.numberOfChannels, 2));
		const buffer = audioContext.createBuffer(channels, audioData.numberOfFrames, audioData.sampleRate);
		let audible = false;
		for (let channel = 0; channel < channels; channel++) {
			const destination = buffer.getChannelData(channel);
			audioData.copyTo(destination, { planeIndex: channel, format: 'f32-planar' });
			if (!audible) {
				for (let index = 0; index < destination.length; index += 16) {
					if (Math.abs(destination[index]) > 0.0001) {audible = true; break;}
				}
			}
		}
		const source = audioContext.createBufferSource();
		source.buffer = buffer;
		source.connect(audioContext.destination);
		const now = audioContext.currentTime;
		if (playheadRef.current < now || playheadRef.current > now + 0.25) {playheadRef.current = now + 0.025;}
		source.start(playheadRef.current);
		playheadRef.current += buffer.duration;
		return audible ? 'audible' : 'silent';
	} finally {
		audioData.close();
	}
}

export function startAudio(
	serverUrl: string,
	contextRef: React.MutableRefObject<AudioContext | undefined>,
	playheadRef: React.MutableRefObject<number>,
	setAudioState: Setter<AudioState>,
	setAudioDetail: Setter<string>,
): () => void {
	const AudioDecoderCtor = (window as unknown as { AudioDecoder?: AudioDecoderConstructor }).AudioDecoder;
	const EncodedAudioChunkCtor = (window as unknown as { EncodedAudioChunk?: new (init: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array }) => unknown }).EncodedAudioChunk;
	if (!AudioDecoderCtor || !EncodedAudioChunkCtor) {
		setAudioState('error');
		setAudioDetail('Opus playback unsupported in this webview');
		return () => {};
	}

	const audioContext = contextRef.current ?? new AudioContext({ sampleRate: 48000 });
	contextRef.current = audioContext;
	setAudioState(audioContext.state === 'running' ? 'on' : 'off');
	let decoder: WebCodecsAudioDecoder | undefined;
	let disposed = false;
	let played = false;
	let quietFrames = 0;
	let failed = false;
	let packetsReceived = 0;
	let work = Promise.resolve();
	let config: Uint8Array | undefined;
	let decoderMode = 0;
	const fail = (detail: string) => {
		if (!disposed) {failed = true; setAudioState('error'); setAudioDetail(detail);}
	};
	const syncAudioState = () => {
		if (disposed) {return;}
		if (!failed) {setAudioState(audioContext.state === 'running' ? 'on' : 'off');}
		if (audioContext.state === 'running' && played) {setAudioDetail('Audio playing');}
		else if (audioContext.state === 'suspended') {setAudioDetail('Click emulator to enable audio');}
	};
	audioContext.addEventListener('statechange', syncAudioState);
	syncAudioState();
	setAudioDetail('Waiting for Android audio');

	const configureDecoder = async (mode: number): Promise<boolean> => {
		const candidate: AudioDecoderConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 };
		if (mode === 1) {candidate.description = config;}
		try {
			if (!(await AudioDecoderCtor.isConfigSupported(candidate)).supported || disposed) {return false;}
			const next = new AudioDecoderCtor({
				output: audioData => {
					try {
						const result = playDecodedAudio(audioContext, playheadRef, audioData);
						if (result === 'audible' && !played) {played = true; setAudioDetail('Audio playing');}
						else if (result === 'silent' && !played && ++quietFrames === 50) {setAudioDetail('Android audio is silent');}
					} catch (error) {fail(`Audio playback failed: ${error instanceof Error ? error.message : String(error)}`);}
				},
				error: error => {
					if (disposed || decoder !== next) {return;}
					if (mode === 0 && config) {
						decoder = undefined;
						work = work.then(async () => {
							if (!(await configureDecoder(1))) {fail(`Opus decode failed: ${error.message}`);}
						});
					} else {fail(`Opus decode failed: ${error.message}`);}
				},
			});
			next.configure(candidate);
			decoder?.close();
			decoder = next;
			decoderMode = mode;
			return true;
		} catch {return false;}
	};

	const socket = new WebSocket(`${serverUrl.replace(/^http:/, 'ws:')}/audio`);
	socket.binaryType = 'arraybuffer';
	socket.onmessage = event => {
		if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 9) {return;}
		const packet = new Uint8Array(event.data);
		const timestamp = Number(new DataView(event.data).getBigUint64(1, false));
		const payload = packet.subarray(9);
		work = work.then(async () => {
			if (disposed) {return;}
			if (packet[0] === 1) {
				config = payload;
				decoder?.close();
				decoder = undefined;
				decoderMode = 0;
				played = false;
				quietFrames = 0;
				playheadRef.current = 0;
				if (!(await configureDecoder(0)) && !(await configureDecoder(1))) {fail('Opus decode unsupported in this webview');}
				else {setAudioDetail(audioContext.state === 'running' ? 'Audio buffering' : 'Click emulator to enable audio');}
				return;
			}
			packetsReceived++;
			if (decoder?.state === 'configured' && decoder.decodeQueueSize < 8) {
				decoder.decode(new EncodedAudioChunkCtor({ type: 'key', timestamp, data: payload }));
			}
		}).catch(error => fail(`Audio failed: ${error instanceof Error ? error.message : String(error)}`));
	};
	socket.onerror = () => fail('Audio connection failed');
	socket.onclose = () => {if (!disposed) {fail('Audio connection closed');}};
	const checkAudio = async () => {
		if (disposed || played || failed) {return;}
		try {
			const response = await fetch(`${serverUrl}/api/status`, { cache: 'no-store' });
			if (!response.ok || disposed || played || failed) {return;}
			const status = await response.json() as { audioConnected: boolean; audioConfigured: boolean; audioPackets: number };
			if (!status.audioConnected) {setAudioDetail('Android audio disconnected');}
			else if (!status.audioConfigured) {setAudioDetail('Waiting for Android audio encoder');}
			else if (status.audioPackets === 0) {setAudioDetail('Waiting for Android sound');}
			else if (!config) {setAudioDetail('Audio setup missing from stream');}
			else if (packetsReceived === 0) {setAudioDetail('Audio packets not reaching webview');}
			else if (audioContext.state !== 'running') {setAudioDetail('Click emulator to enable audio');}
			else if (decoderMode === 1) {setAudioDetail('Audio buffering (OpusHead)');}
		} catch { /* The stream can work while status polling is unavailable. */ }
	};
	const interval = window.setInterval(() => {void checkAudio();}, 3000);
	return () => {
		disposed = true;
		window.clearInterval(interval);
		audioContext.removeEventListener('statechange', syncAudioState);
		socket.close();
		if (decoder?.state !== 'closed') {decoder?.close();}
	};
}
