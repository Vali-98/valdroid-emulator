import type { DeviceVolume, ServerStatus } from '../../../shared/protocol';
import { socketUrl } from '../api';

type OpusDecoder = import('opus-decoder', { with: { 'resolution-mode': 'import' } }).OpusDecoder;
type OpusDecodedAudio = import('opus-decoder', { with: { 'resolution-mode': 'import' } }).OpusDecodedAudio;

export interface AudioStatus {
	state: 'off' | 'on' | 'error';
	detail: string;
}

export interface AudioStream {
	stop(): void;
	setVolume(volume: DeviceVolume): void;
	updateServerStatus(status: ServerStatus): void;
}

function playDecodedAudio(audioContext: AudioContext, output: AudioNode, playheadRef: { current: number }, audio: OpusDecodedAudio): 'muted' | 'silent' | 'audible' {
	if (audio.samplesDecoded === 0 || audio.channelData.length === 0) {return 'silent';}
	if (audioContext.state !== 'running') {return 'muted';}
	const channels = Math.min(audio.channelData.length, 2);
	const buffer = audioContext.createBuffer(channels, audio.samplesDecoded, audio.sampleRate);
	let audible = false;
	for (let channel = 0; channel < channels; channel++) {
		const samples = audio.channelData[channel];
		buffer.getChannelData(channel).set(samples);
		if (!audible) {
			for (let index = 0; index < samples.length; index += 16) {
				if (Math.abs(samples[index]) > 0.0001) {audible = true; break;}
			}
		}
	}
	const source = audioContext.createBufferSource();
	source.buffer = buffer;
	source.connect(output);
	const now = audioContext.currentTime;
	if (playheadRef.current < now || playheadRef.current > now + 0.25) {playheadRef.current = now + 0.025;}
	source.start(playheadRef.current);
	playheadRef.current += buffer.duration;
	return audible ? 'audible' : 'silent';
}

export function startAudio(
	serverUrl: string,
	audioContext: AudioContext,
	update: (status: Partial<AudioStatus>) => void,
): AudioStream {
	const setAudioState = (state: AudioStatus['state']) => update({ state });
	const setAudioDetail = (detail: string) => update({ detail });
	const playheadRef = { current: 0 };
	const gain = audioContext.createGain();
	gain.connect(audioContext.destination);
	setAudioState(audioContext.state === 'running' ? 'on' : 'off');
	setAudioDetail('Waiting for Android audio');
	let decoder: OpusDecoder | undefined;
	let disposed = false;
	let played = false;
	let quietFrames = 0;
	let failed = false;
	let packetsReceived = 0;
	let pendingPackets = 0;
	let work = Promise.resolve();
	let configured = false;
	const fail = (detail: string) => {
		if (!disposed) {failed = true; setAudioState('error'); setAudioDetail(detail);}
	};
	const syncAudioState = () => {
		if (disposed || failed) {return;}
		setAudioState(audioContext.state === 'running' ? 'on' : 'off');
		if (audioContext.state === 'running' && played) {setAudioDetail('Audio playing');}
		else if (audioContext.state === 'suspended') {setAudioDetail('Click emulator to enable audio');}
	};
	audioContext.addEventListener('statechange', syncAudioState);
	syncAudioState();

	const socket = new WebSocket(socketUrl(serverUrl, '/audio'));
	socket.binaryType = 'arraybuffer';
	socket.onmessage = event => {
		if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 9 || disposed || failed) {return;}
		const packet = new Uint8Array(event.data);
		const payload = packet.subarray(9);
		if (packet[0] !== 1 && pendingPackets >= 100) {return;}
		pendingPackets++;
		work = work.then(async () => {
			if (disposed || failed) {return;}
			if (packet[0] === 1) {
				if (payload.length < 19 || String.fromCharCode(...payload.subarray(0, 8)) !== 'OpusHead') {throw new Error('Invalid Android Opus setup');}
				const { OpusDecoder } = await import('opus-decoder');
				if (disposed) {return;}
				decoder?.free();
				decoder = new OpusDecoder({ channels: payload[9], preSkip: payload[10] | (payload[11] << 8) });
				configured = false;
				played = false;
				quietFrames = 0;
				playheadRef.current = 0;
				setAudioDetail('Loading Opus decoder');
				await decoder.ready;
				if (disposed) {return;}
				configured = true;
				setAudioDetail(audioContext.state === 'running' ? 'Audio buffering' : 'Click emulator to enable audio');
				return;
			}
			packetsReceived++;
			if (!configured || !decoder) {return;}
			const audio = decoder.decodeFrame(payload);
			if (audio.errors.length > 0) {throw new Error(audio.errors[0].message);}
			const result = playDecodedAudio(audioContext, gain, playheadRef, audio);
			if (result === 'audible' && !played) {played = true; setAudioDetail('Audio playing');}
			else if (result === 'silent' && !played && ++quietFrames === 50) {setAudioDetail('Android audio is silent');}
		}).catch(error => fail(`Audio decode failed: ${error instanceof Error ? error.message : String(error)}`)).finally(() => {pendingPackets--;});
	};
	socket.onerror = () => fail('Audio connection failed');
	socket.onclose = () => {if (!disposed) {fail('Audio connection closed');}};
	return {
		updateServerStatus(status) {
			if (disposed || played || failed) {return;}
			if (!status.audioConnected) {setAudioDetail('Android audio disconnected');}
			else if (!status.audioConfigured) {setAudioDetail('Waiting for Android audio encoder');}
			else if (status.audioPackets === 0) {setAudioDetail('Waiting for Android sound');}
			else if (!configured) {setAudioDetail('Loading Opus decoder');}
			else if (packetsReceived === 0) {setAudioDetail('Audio packets not reaching webview');}
			else if (audioContext.state !== 'running') {setAudioDetail('Click emulator to enable audio');}
		},
		setVolume(volume) {
			if (disposed || volume.max <= volume.min) {return;}
			const level = Math.max(0, Math.min(1, (volume.current - volume.min) / (volume.max - volume.min)));
			gain.gain.setTargetAtTime(level, audioContext.currentTime, 0.04);
		},
		stop() {
			disposed = true;
			audioContext.removeEventListener('statechange', syncAudioState);
			socket.close();
			gain.disconnect();
			void work.then(() => decoder?.free());
		},
	};
}
