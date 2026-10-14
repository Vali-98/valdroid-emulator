import * as React from 'react';
import { createRoot } from 'react-dom/client';

declare function acquireVsCodeApi(): { postMessage(message: HostMessage): void };

interface EmulatorTarget {
	label: string;
	value: string;
}

interface DisplayState {
	id: number;
	width: number;
	height: number;
	orientation: number;
}

type HostMessage =
	| { type: 'ready' | 'refresh' | 'stop' | 'close' }
	| { type: 'start'; value: string };

type ExtensionMessage =
	| { type: 'targets'; targets: EmulatorTarget[] }
	| { type: 'status'; status: string; state: 'idle' | 'online' | 'error'; serverUrl?: string };

const vscode = acquireVsCodeApi();
const initialDisplay: DisplayState = { id: 0, width: 0, height: 0, orientation: 0 };

function App(): React.JSX.Element {
	const [targets, setTargets] = React.useState<EmulatorTarget[]>([]);
	const [selectedTarget, setSelectedTarget] = React.useState('');
	const [status, setStatus] = React.useState('Select an emulator');
	const [state, setState] = React.useState<'idle' | 'online' | 'error'>('idle');
	const [serverUrl, setServerUrl] = React.useState('');
	const [display, setDisplay] = React.useState<DisplayState>(initialDisplay);
	const [audioState, setAudioState] = React.useState<'off' | 'on' | 'error'>('off');
	const imageRef = React.useRef<HTMLImageElement>(null);
	const socketRef = React.useRef<WebSocket | undefined>(undefined);
	const audioSocketRef = React.useRef<WebSocket | undefined>(undefined);
	const audioContextRef = React.useRef<AudioContext | undefined>(undefined);
	const audioPlayheadRef = React.useRef(0);
	const pointerIdRef = React.useRef<number | null>(null);

	React.useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data;
			if (message.type === 'targets') {
				setTargets(message.targets);
				setSelectedTarget(previous => {
					if (message.targets.some(target => target.value === previous)) {
						return previous;
					}
					return message.targets[0]?.value ?? '';
				});
			}
			if (message.type === 'status') {
				setStatus(message.status);
				setState(message.state);
				setServerUrl(message.serverUrl ?? '');
			}
		};
		window.addEventListener('message', handleMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, []);

	React.useEffect(() => {
		socketRef.current?.close();
		socketRef.current = undefined;
		audioSocketRef.current?.close();
		audioSocketRef.current = undefined;
		setDisplay(initialDisplay);
		if (!serverUrl) {
			return;
		}

		const socket = new WebSocket(`${serverUrl.replace(/^http:/, 'ws:')}/control`);
		socketRef.current = socket;
		socket.onopen = () => setStatus('Emulator connected');
		socket.onclose = () => setStatus('Input connection closed');
		socket.onerror = () => setStatus('Input connection failed');
		const stopAudio = startAudio(serverUrl, audioSocketRef, audioContextRef, audioPlayheadRef, setAudioState);

		let disposed = false;
		const loadDisplay = async () => {
			try {
				const response = await fetch(`${serverUrl}/api/display-state?display=0`, { cache: 'no-store' });
				if (!disposed && response.ok) {
					setDisplay(await response.json() as DisplayState);
				}
			} catch {
				// The status endpoint can lag briefly while the agent starts.
			}
		};
		const interval = window.setInterval(loadDisplay, 500);
		void loadDisplay();

		return () => {
			disposed = true;
			window.clearInterval(interval);
			socket.close();
			stopAudio();
		};
	}, [serverUrl]);

	const start = () => {
		if (selectedTarget) {
			const context = audioContextRef.current ?? new AudioContext({ sampleRate: 48000 });
			audioContextRef.current = context;
			void context.resume().then(() => setAudioState('on')).catch(() => setAudioState('off'));
			vscode.postMessage({ type: 'start', value: selectedTarget });
		}
	};

	const stop = () => vscode.postMessage({ type: 'stop' });
	const close = () => vscode.postMessage({ type: 'close' });
	const isLoading = state === 'online' && !serverUrl;
	const title = serverUrl ? activeDeviceName(status) : 'No Emulator Loaded';
	const displayMeta = display.width > 0 && display.height > 0 ? `${display.width}x${display.height} · rotation ${display.orientation}` : '';

	const mapPoint = (clientX: number, clientY: number, clamp = true) => {
		const image = imageRef.current;
		if (!image || !image.naturalWidth || !image.naturalHeight || !display.width || !display.height) {
			return null;
		}
		const rect = image.getBoundingClientRect();
		const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
		const width = image.naturalWidth * scale;
		const height = image.naturalHeight * scale;
		const left = rect.left + (rect.width - width) / 2;
		const top = rect.top + (rect.height - height) / 2;
		if (!clamp && (clientX < left || clientX >= left + width || clientY < top || clientY >= top + height)) {
			return null;
		}
		const nx = Math.max(0, Math.min(1, (clientX - left) / width));
		const ny = Math.max(0, Math.min(1, (clientY - top) / height));
		let x = nx;
		let y = ny;
		switch (display.orientation & 3) {
			case 1: x = 1 - ny; y = nx; break;
			case 2: x = 1 - nx; y = 1 - ny; break;
			case 3: x = ny; y = 1 - nx; break;
		}
		return {
			x: Math.round(x * (display.width - 1)),
			y: Math.round(y * (display.height - 1)),
		};
	};

	const sendMotion = (event: React.PointerEvent | PointerEvent | React.WheelEvent, action: number, axes: Array<{ axis: number; value: number }> = []) => {
		const socket = socketRef.current;
		if (socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		const point = mapPoint(event.clientX, event.clientY);
		if (!point) {
			return;
		}
		socket.send(JSON.stringify({
			type: 'motion',
			pointers: [{ ...point, id: 0, axes }],
			action,
			buttonState: 0,
			actionButton: 0,
			displayId: display.id || 0,
			isMouse: false,
		}));
	};

	const release = (event: PointerEvent) => {
		if (event.pointerId !== pointerIdRef.current) {
			return;
		}
		sendMotion(event, 1);
		pointerIdRef.current = null;
	};

	React.useEffect(() => {
		const handleMove = (event: PointerEvent) => {
			if (event.pointerId !== pointerIdRef.current) {
				return;
			}
			if (event.pointerType === 'mouse' && event.buttons === 0) {
				release(event);
				return;
			}
			sendMotion(event, 2);
		};
		const handleUp = (event: PointerEvent) => release(event);
		const handleCancel = (event: PointerEvent) => release(event);
		window.addEventListener('pointermove', handleMove);
		window.addEventListener('pointerup', handleUp);
		window.addEventListener('pointercancel', handleCancel);
		return () => {
			window.removeEventListener('pointermove', handleMove);
			window.removeEventListener('pointerup', handleUp);
			window.removeEventListener('pointercancel', handleCancel);
		};
	});

	const sendKey = (event: React.KeyboardEvent, action: number) => {
		const keyCode = androidKeyCode(event.key);
		const socket = socketRef.current;
		if (!keyCode || socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		event.preventDefault();
		socket.send(JSON.stringify({ type: 'key', action, keyCode, metaState: metaState(event) }));
	};

	return (
		<div className="app">
			<header className="topbar">
				<div className="topbar-spacer" />
				<div className={`device-pill ${serverUrl ? 'loaded' : ''}`}>{title}</div>
				<button type="button" className="close-button" disabled={!serverUrl} onClick={close} aria-label="Close emulator" title="Close emulator">
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
					</svg>
				</button>
			</header>
			<main className="stage">
				{serverUrl ? (
					<div className="screen-frame">
						<img
							ref={imageRef}
							id="screen"
							src={`${serverUrl}/stream`}
							alt="Android emulator display"
							draggable={false}
							tabIndex={0}
							onPointerDown={event => {
								if (pointerIdRef.current !== null || (event.pointerType === 'mouse' && event.button !== 0) || !mapPoint(event.clientX, event.clientY, false)) {
									return;
								}
								event.preventDefault();
								event.currentTarget.focus({ preventScroll: true });
								event.currentTarget.setPointerCapture(event.pointerId);
								pointerIdRef.current = event.pointerId;
								sendMotion(event, 0);
							}}
							onContextMenu={event => event.preventDefault()}
							onWheel={event => {
								event.preventDefault();
								sendMotion(event, 8, [{ axis: 9, value: -event.deltaY }, { axis: 10, value: event.deltaX }]);
							}}
							onKeyDown={event => sendKey(event, 0)}
							onKeyUp={event => sendKey(event, 1)}
						/>
					</div>
				) : isLoading ? (
					<div className="loading">
						<div className="spinner" />
						<div className="loading-status">{status}</div>
					</div>
				) : (
					<div className="empty">
						<div className="device-picker">
							<select aria-label="Select device" value={selectedTarget} onChange={event => setSelectedTarget(event.target.value)} onFocus={() => vscode.postMessage({ type: 'refresh' })}>
								<option value="" disabled>Select Device...</option>
								{targets.length === 0 && <option value="">No devices found</option>}
								{targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}
							</select>
							<button type="button" className="play-button" disabled={!selectedTarget} onClick={start} aria-label="Start emulator" title="Start emulator">
								<svg viewBox="0 0 16 16" aria-hidden="true">
									<path d="M5 3.5v9l7-4.5-7-4.5Z" />
								</svg>
							</button>
						</div>
						{state === 'error' && <div className="error-message">{status}</div>}
					</div>
				)}
			</main>
			<footer className="bottombar">
				{serverUrl && <div className={`status ${state}`}>{displayMeta ? `${status} · ${displayMeta}` : status}</div>}
				{serverUrl && <button type="button" className="audio-button" disabled={audioState === 'error'} onClick={() => {
					const context = audioContextRef.current;
					if (!context) {
						return;
					}
					void (context.state === 'running' ? context.suspend() : context.resume()).then(() => setAudioState(context.state === 'running' ? 'on' : 'off')).catch(() => setAudioState('error'));
				}} aria-label={audioState === 'error' ? 'Audio unavailable' : audioState === 'on' ? 'Mute sound' : 'Enable sound'} title={audioState === 'error' ? 'Audio unavailable' : audioState === 'on' ? 'Mute sound' : 'Enable sound'}>{audioState === 'error' ? 'Audio unavailable' : audioState === 'on' ? 'Sound on' : 'Sound off'}</button>}
			</footer>
		</div>
	);
}

function activeDeviceName(status: string): string {
	const match = /^Connected\s*.\s*(.+)$/.exec(status);
	return match?.[1] || 'Emulator Loaded';
}

function startAudio(
	serverUrl: string,
	socketRef: React.MutableRefObject<WebSocket | undefined>,
	contextRef: React.MutableRefObject<AudioContext | undefined>,
	playheadRef: React.MutableRefObject<number>,
	setAudioState: React.Dispatch<React.SetStateAction<'off' | 'on' | 'error'>>,
): () => void {
	const AudioDecoderCtor = (window as unknown as { AudioDecoder?: unknown }).AudioDecoder as (new (init: {
		output: (audioData: WebCodecsAudioData) => void;
		error: (error: Error) => void;
	}) => WebCodecsAudioDecoder) | undefined;
	const EncodedAudioChunkCtor = (window as unknown as { EncodedAudioChunk?: unknown }).EncodedAudioChunk as (new (init: {
		type: 'key' | 'delta';
		timestamp: number;
		data: Uint8Array;
	}) => unknown) | undefined;
	if (!AudioDecoderCtor || !EncodedAudioChunkCtor) {
		setAudioState('error');
		return () => {};
	}

	const audioContext = contextRef.current ?? new AudioContext({ sampleRate: 48000 });
	contextRef.current = audioContext;
	setAudioState(audioContext.state === 'running' ? 'on' : 'off');
	const syncAudioState = () => setAudioState(previous => previous === 'error' ? previous : audioContext.state === 'running' ? 'on' : 'off');
	audioContext.addEventListener('statechange', syncAudioState);

	const decoder = new AudioDecoderCtor({
		output: audioData => playDecodedAudio(audioContext, playheadRef, audioData),
		error: () => setAudioState('error'),
	});
	const socket = new WebSocket(`${serverUrl.replace(/^http:/, 'ws:')}/audio`);
	socket.binaryType = 'arraybuffer';
	socketRef.current = socket;
	socket.onmessage = event => {
		if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 9) {
			return;
		}
		const packet = new Uint8Array(event.data);
		const view = new DataView(event.data);
		const isConfig = packet[0] === 1;
		const timestamp = Number(view.getBigUint64(1, false));
		const payload = packet.slice(9);
		try {
			if (isConfig) {
				decoder.configure({
					codec: 'opus',
					sampleRate: 48000,
					numberOfChannels: 2,
					description: payload,
				});
				playheadRef.current = audioContext.currentTime + 0.08;
				return;
			}
			if (decoder.state === 'configured') {
				decoder.decode(new EncodedAudioChunkCtor({ type: 'key', timestamp, data: payload }));
			}
		} catch {
			setAudioState('error');
		}
	};
	socket.onerror = () => setAudioState('error');
	socket.onclose = () => {
		if (decoder.state !== 'closed') {
			decoder.close();
		}
	};
	return () => {
		audioContext.removeEventListener('statechange', syncAudioState);
		socket.close();
		if (decoder.state !== 'closed') {
			decoder.close();
		}
	};
}

interface WebCodecsAudioDecoder {
	readonly state: 'unconfigured' | 'configured' | 'closed';
	configure(config: { codec: string; sampleRate: number; numberOfChannels: number; description?: Uint8Array }): void;
	decode(chunk: unknown): void;
	close(): void;
}

interface WebCodecsAudioData {
	readonly numberOfFrames: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	allocationSize(options: { planeIndex: number; format: 'f32-planar' }): number;
	copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void;
	close(): void;
}

function playDecodedAudio(audioContext: AudioContext, playheadRef: React.MutableRefObject<number>, audioData: WebCodecsAudioData): void {
	try {
		const channels = Math.max(1, Math.min(audioData.numberOfChannels, 2));
		const audioBuffer = audioContext.createBuffer(channels, audioData.numberOfFrames, audioData.sampleRate);
		for (let channel = 0; channel < channels; channel++) {
			const destination = audioBuffer.getChannelData(channel);
			audioData.copyTo(destination, { planeIndex: channel, format: 'f32-planar' });
		}
		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(audioContext.destination);
		const startAt = Math.max(audioContext.currentTime, playheadRef.current);
		source.start(startAt);
		playheadRef.current = startAt + audioBuffer.duration;
	} finally {
		audioData.close();
	}
}

const keyCodes: Record<string, number> = {
	Enter: 66,
	Escape: 111,
	Backspace: 67,
	Tab: 61,
	' ': 62,
	ArrowUp: 19,
	ArrowDown: 20,
	ArrowLeft: 21,
	ArrowRight: 22,
	Home: 3,
	End: 123,
	PageUp: 92,
	PageDown: 93,
	Delete: 112,
	Shift: 59,
	Control: 113,
	Alt: 57,
	Meta: 117,
};

function androidKeyCode(key: string): number {
	if (/^[a-z]$/i.test(key)) {
		return key.toUpperCase().charCodeAt(0) - 65 + 29;
	}
	if (/^[0-9]$/.test(key)) {
		return key === '0' ? 7 : Number(key) + 7;
	}
	return keyCodes[key] || 0;
}

function metaState(event: React.KeyboardEvent): number {
	return (event.shiftKey ? 1 : 0) | (event.altKey ? 2 : 0) | (event.ctrlKey ? 0x1000 : 0) | (event.metaKey ? 0x10000 : 0);
}

const style = document.createElement('style');
style.textContent = `
	* { box-sizing: border-box; }
	html, body, #root { height: 100%; }
	body {
		color: var(--vscode-foreground);
		background: var(--vscode-sideBar-background);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
	}
	.app {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		height: 100vh;
		min-width: 0;
	}
	.topbar {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) 32px;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--vscode-panel-border);
		background: var(--vscode-sideBar-background);
	}
	.topbar-spacer {
		width: 32px;
		height: 32px;
	}
	.device-pill {
		min-width: 0;
		justify-self: center;
		max-width: 100%;
		padding: 5px 12px;
		border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
		border-radius: 999px;
		color: var(--vscode-descriptionForeground);
		background: var(--vscode-editor-background);
		font-size: 12px;
		font-weight: 600;
		line-height: 18px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.device-pill.loaded {
		color: var(--vscode-foreground);
		border-color: var(--vscode-focusBorder);
	}
	select,
	button {
		min-width: 0;
		font: inherit;
		outline: none;
	}
	select {
		height: 34px;
		color: var(--vscode-dropdown-foreground);
		background: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
		border-radius: 6px;
		padding: 0 10px;
	}
	button {
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
		border: 1px solid var(--vscode-button-border, transparent);
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--vscode-button-hoverBackground);
	}
	button:disabled,
	select:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.close-button {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		color: var(--vscode-icon-foreground);
		background: transparent;
		border-color: transparent;
		border-radius: 6px;
	}
	.close-button:disabled {
		visibility: hidden;
	}
	.close-button svg {
		width: 18px;
		height: 18px;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		fill: none;
	}
	.close-button:hover:not(:disabled) {
		color: var(--vscode-foreground);
		background: var(--vscode-toolbar-hoverBackground);
	}
	.stage {
		min-height: 0;
		min-width: 0;
		position: relative;
		overflow: hidden;
	}
	.screen-frame {
		position: absolute;
		inset: 10px;
		overflow: hidden;
		border-radius: 8px;
		background: #000;
	}
	#screen {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		user-select: none;
		outline: none;
		object-fit: contain;
	}
	#screen:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		gap: 10px;
		place-content: center;
		justify-items: center;
		padding: 16px;
		color: var(--vscode-descriptionForeground);
		text-align: center;
	}
	.device-picker {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 38px;
		gap: 8px;
		width: min(100%, 360px);
		padding: 8px;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 8px;
		background: var(--vscode-sideBar-background);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
	}
	.play-button {
		display: grid;
		place-items: center;
		width: 38px;
		height: 34px;
		padding: 0;
		border-radius: 6px;
	}
	.play-button svg {
		width: 18px;
		height: 18px;
		fill: currentColor;
	}
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		gap: 12px;
		place-content: center;
		justify-items: center;
		color: var(--vscode-descriptionForeground);
		text-align: center;
	}
	.spinner {
		width: 28px;
		height: 28px;
		border: 3px solid var(--vscode-panel-border);
		border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
		border-radius: 50%;
		animation: spin 0.85s linear infinite;
	}
	.loading-status,
	.error-message,
	.status {
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	.error-message {
		color: var(--vscode-errorForeground);
	}
	.bottombar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 28px;
		padding: 6px 8px;
		border-top: 1px solid var(--vscode-panel-border);
		color: var(--vscode-descriptionForeground);
		background: var(--vscode-sideBar-background);
	}
	.status.online { color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground)); }
	.status.error { color: var(--vscode-errorForeground); }
	.audio-button {
		flex: none;
		padding: 2px 6px;
		font-size: 11px;
		border-radius: 4px;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
`;
document.head.append(style);

const root = document.getElementById('root');
if (root) {
	createRoot(root).render(<App />);
}
