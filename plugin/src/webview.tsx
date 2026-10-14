import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { startAudio } from './webview/audio';
import { DevicePicker, DeviceRail, EmulatorScreen, FileDropOverlay, Header, LoadingState, StatusBar, type EmulatorTarget } from './webview/components';
import { androidKeyCode, metaState, visibleImageRect } from './webview/input';
import { useDeviceVolume } from './webview/useDeviceVolume';
import { useFileDrop } from './webview/useFileDrop';
import './webview/styles';

declare function acquireVsCodeApi(): { postMessage(message: HostMessage): void };

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
	| { type: 'status'; status: string; state: 'idle' | 'online' | 'error'; serverUrl?: string; deviceName?: string };

const vscode = acquireVsCodeApi();
const initialDisplay: DisplayState = { id: 0, width: 0, height: 0, orientation: 0 };

function App(): React.JSX.Element {
	const [targets, setTargets] = React.useState<EmulatorTarget[]>([]);
	const [selectedTarget, setSelectedTarget] = React.useState('');
	const [status, setStatus] = React.useState('Select an emulator');
	const [state, setState] = React.useState<'idle' | 'online' | 'error'>('idle');
	const [serverUrl, setServerUrl] = React.useState('');
	const [deviceName, setDeviceName] = React.useState('');
	const [debugVisible, setDebugVisible] = React.useState(false);
	const [display, setDisplay] = React.useState<DisplayState>(initialDisplay);
	const [audioState, setAudioState] = React.useState<'off' | 'on' | 'error'>('off');
	const [audioDetail, setAudioDetail] = React.useState('Waiting for Android audio');
	const [railLeft, setRailLeft] = React.useState(10);
	const stageRef = React.useRef<HTMLElement>(null);
	const imageRef = React.useRef<HTMLImageElement>(null);
	const socketRef = React.useRef<WebSocket | undefined>(undefined);
	const audioContextRef = React.useRef<AudioContext | undefined>(undefined);
	const audioGainRef = React.useRef<GainNode | undefined>(undefined);
	const audioPlayheadRef = React.useRef(0);
	const pointerIdRef = React.useRef<number | null>(null);
	const refreshDeviceVolume = useDeviceVolume(serverUrl, audioGainRef);
	const fileDrop = useFileDrop(serverUrl);

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
				setDeviceName(message.deviceName ?? '');
			}
		};
		window.addEventListener('message', handleMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, []);

	React.useEffect(() => {
		socketRef.current?.close();
		socketRef.current = undefined;
		setDisplay(initialDisplay);
		if (!serverUrl) {
			return;
		}

		const socket = new WebSocket(`${serverUrl.replace(/^http:/, 'ws:')}/control`);
		socketRef.current = socket;
		socket.onopen = () => setStatus('Emulator connected');
		socket.onclose = () => setStatus('Input connection closed');
		socket.onerror = () => setStatus('Input connection failed');
		const stopAudio = startAudio(serverUrl, audioContextRef, audioGainRef, audioPlayheadRef, setAudioState, setAudioDetail);

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

	React.useEffect(() => {
		if (!serverUrl) {setDebugVisible(false);}
	}, [serverUrl]);

	React.useEffect(() => {
		const stage = stageRef.current;
		if (!stage || !serverUrl) {
			return;
		}
		const updateRail = () => {
			const image = imageRef.current;
			if (!image?.naturalWidth || !image.naturalHeight) {
				return;
			}
			const visible = visibleImageRect(image);
			const stageRect = stage.getBoundingClientRect();
			setRailLeft(Math.max(2, Math.min(stageRect.width - 40, Math.round(visible.left + visible.width - stageRect.left + 6))));
		};
		const observer = new ResizeObserver(updateRail);
		observer.observe(stage);
		updateRail();
		return () => observer.disconnect();
	}, [serverUrl, display.width, display.height, display.orientation]);

	React.useEffect(() => {
		if (!serverUrl) {return;}
		const resumeAudio = () => {void audioContextRef.current?.resume();};
		window.addEventListener('pointerdown', resumeAudio);
		window.addEventListener('keydown', resumeAudio);
		return () => {
			window.removeEventListener('pointerdown', resumeAudio);
			window.removeEventListener('keydown', resumeAudio);
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

	const close = () => vscode.postMessage({ type: 'close' });
	const sendDeviceKey = (keyCode: number) => {
		const socket = socketRef.current;
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'key', action: 8, keyCode, metaState: 0 }));
			if (keyCode === 24 || keyCode === 25 || keyCode === 164) {window.setTimeout(refreshDeviceVolume, 300);}
		}
	};
	const isLoading = state === 'online' && !serverUrl;
	const title = serverUrl ? deviceName || 'Emulator Loaded' : 'No Emulator Loaded';
	const displayMeta = display.width > 0 && display.height > 0 ? `${display.width}x${display.height} · rotation ${display.orientation}` : '';

	const mapPoint = (clientX: number, clientY: number, clamp = true) => {
		const image = imageRef.current;
		if (!image || !image.naturalWidth || !image.naturalHeight || !display.width || !display.height) {
			return null;
		}
		const { left, top, width, height } = visibleImageRect(image);
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
			<Header title={title} loaded={Boolean(serverUrl)} debugVisible={debugVisible} onToggleDebug={() => setDebugVisible(value => !value)} onClose={close} />
			<main className="stage" ref={stageRef} onDragEnter={fileDrop.onDragEnter} onDragLeave={fileDrop.onDragLeave} onDragOver={fileDrop.onDragOver} onDrop={fileDrop.onDrop}>
				{serverUrl ? <>
					<DeviceRail left={railLeft} onKey={sendDeviceKey} />
					<EmulatorScreen
						serverUrl={serverUrl}
						imageRef={imageRef}
						onLoad={() => {
							const image = imageRef.current;
							const stage = stageRef.current;
							if (image && stage) {
								const visible = visibleImageRect(image);
								const stageRect = stage.getBoundingClientRect();
								setRailLeft(Math.max(2, Math.min(stageRect.width - 40, Math.round(visible.left + visible.width - stageRect.left + 6))));
							}
						}}
						onPointerDown={event => {
							if (pointerIdRef.current !== null || (event.pointerType === 'mouse' && event.button !== 0) || !mapPoint(event.clientX, event.clientY, false)) {return;}
							event.preventDefault();
							event.currentTarget.focus({ preventScroll: true });
							event.currentTarget.setPointerCapture(event.pointerId);
							pointerIdRef.current = event.pointerId;
							sendMotion(event, 0);
							void audioContextRef.current?.resume();
						}}
						onWheel={event => {
							event.preventDefault();
							sendMotion(event, 8, [{ axis: 9, value: -event.deltaY }, { axis: 10, value: event.deltaX }]);
						}}
						onKeyDown={event => sendKey(event, 0)}
						onKeyUp={event => sendKey(event, 1)}
					/>
					<FileDropOverlay dragging={fileDrop.dragging} message={fileDrop.message} progress={fileDrop.progress} elapsedSeconds={fileDrop.elapsedSeconds} complete={fileDrop.complete} error={fileDrop.error} />
				</> : isLoading ? <LoadingState status={status} /> : <DevicePicker
					targets={targets}
					selected={selectedTarget}
					onSelect={setSelectedTarget}
					onRefresh={() => vscode.postMessage({ type: 'refresh' })}
					onStart={start}
					error={state === 'error' ? status : undefined}
				/>}
			</main>
			{debugVisible && <StatusBar status={status} state={state} displayMeta={displayMeta} audioDetail={audioDetail} audioState={audioState} loaded={Boolean(serverUrl)} />}
		</div>
	);
}


const root = document.getElementById('root');
if (root) {
	createRoot(root).render(<App />);
}
