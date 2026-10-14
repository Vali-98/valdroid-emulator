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
	const imageRef = React.useRef<HTMLImageElement>(null);
	const socketRef = React.useRef<WebSocket | undefined>(undefined);
	const pointerIdRef = React.useRef<number | null>(null);
	const buttonsRef = React.useRef(0);

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
		setDisplay(initialDisplay);
		if (!serverUrl) {
			return;
		}

		const socket = new WebSocket(`${serverUrl.replace(/^http:/, 'ws:')}/control`);
		socketRef.current = socket;
		socket.onopen = () => setStatus('Emulator connected');
		socket.onclose = () => setStatus('Input connection closed');
		socket.onerror = () => setStatus('Input connection failed');

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
		};
	}, [serverUrl]);

	const start = () => {
		if (selectedTarget) {
			vscode.postMessage({ type: 'start', value: selectedTarget });
		}
	};

	const stop = () => vscode.postMessage({ type: 'stop' });
	const close = () => vscode.postMessage({ type: 'close' });

	const mapPoint = (clientX: number, clientY: number) => {
		const screen = imageRef.current;
		if (!screen) {
			return { x: 0, y: 0 };
		}
		const rect = screen.getBoundingClientRect();
		const width = screen.naturalWidth || rect.width;
		const height = screen.naturalHeight || rect.height;
		const x = Math.max(0, Math.min(width - 1, Math.floor((clientX - rect.left) * width / rect.width)));
		const y = Math.max(0, Math.min(height - 1, Math.floor((clientY - rect.top) * height / rect.height)));
		const nx = x / Math.max(width - 1, 1);
		const ny = y / Math.max(height - 1, 1);
		const dw = display.width || width;
		const dh = display.height || height;
		switch (display.orientation & 3) {
			case 1: return { x: Math.round((1 - ny) * (dw - 1)), y: Math.round(nx * (dh - 1)) };
			case 2: return { x: Math.round((1 - nx) * (dw - 1)), y: Math.round((1 - ny) * (dh - 1)) };
			case 3: return { x: Math.round(ny * (dw - 1)), y: Math.round((1 - nx) * (dh - 1)) };
			default: return { x: Math.round(nx * (dw - 1)), y: Math.round(ny * (dh - 1)) };
		}
	};

	const sendMotion = (event: React.PointerEvent | PointerEvent | React.WheelEvent, action: number, buttonState = buttonsRef.current, actionButton = 0, axes: Array<{ axis: number; value: number }> = []) => {
		const socket = socketRef.current;
		if (socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		const point = mapPoint(event.clientX, event.clientY);
		socket.send(JSON.stringify({
			type: 'motion',
			pointers: [{ ...point, id: 0, axes }],
			action,
			buttonState,
			actionButton,
			displayId: display.id || 0,
			isMouse: 'pointerType' in event && event.pointerType === 'mouse',
		}));
	};

	const release = (event: PointerEvent, lost = false) => {
		if (event.pointerId !== pointerIdRef.current) {
			return;
		}
		const mask = lost ? buttonsRef.current : event.pointerType === 'mouse' ? buttonMask(event.button) : 0;
		buttonsRef.current &= ~mask;
		sendMotion(event, 1, buttonsRef.current, mask);
		pointerIdRef.current = null;
	};

	React.useEffect(() => {
		const handleMove = (event: PointerEvent) => {
			if (event.pointerId !== pointerIdRef.current) {
				return;
			}
			if (event.pointerType === 'mouse' && event.buttons === 0 && buttonsRef.current !== 0) {
				release(event, true);
				return;
			}
			sendMotion(event, 2);
		};
		const handleUp = (event: PointerEvent) => release(event);
		const handleCancel = (event: PointerEvent) => release(event, true);
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
			<header className="toolbar">
				<select aria-label="Emulator" value={selectedTarget} onChange={event => setSelectedTarget(event.target.value)} onFocus={() => vscode.postMessage({ type: 'refresh' })}>
					{targets.length === 0 && <option value="">No emulators found</option>}
					{targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}
				</select>
				<button type="button" disabled={!selectedTarget} onClick={start}>Start</button>
				<button type="button" disabled={!serverUrl} onClick={stop}>Stop</button>
				<button type="button" className="icon-button" disabled={!serverUrl} onClick={close} aria-label="Close emulator" title="Close emulator">x</button>
			</header>
			<main className="stage">
				{serverUrl ? (
					<img
						ref={imageRef}
						id="screen"
						src={`${serverUrl}/stream`}
						alt="Android emulator display"
						draggable={false}
						tabIndex={0}
						onPointerDown={event => {
							if (pointerIdRef.current !== null) {
								return;
							}
							event.preventDefault();
							event.currentTarget.focus({ preventScroll: true });
							event.currentTarget.setPointerCapture(event.pointerId);
							pointerIdRef.current = event.pointerId;
							if (event.pointerType === 'mouse') {
								const mask = buttonMask(event.button);
								buttonsRef.current |= mask;
								sendMotion(event, 0, buttonsRef.current, mask);
							} else {
								sendMotion(event, 0, 0, 0);
							}
						}}
						onContextMenu={event => event.preventDefault()}
						onWheel={event => {
							event.preventDefault();
							sendMotion(event, 8, buttonsRef.current, 0, [{ axis: 9, value: -event.deltaY }, { axis: 10, value: event.deltaX }]);
						}}
						onKeyDown={event => sendKey(event, 0)}
						onKeyUp={event => sendKey(event, 1)}
					/>
				) : (
					<div className="empty">
						<div className="empty-title">No emulator stream</div>
						<div className="empty-detail">Choose an emulator and press Start.</div>
					</div>
				)}
			</main>
			<footer className={`status ${state}`}>{status}</footer>
		</div>
	);
}

function buttonMask(button: number): number {
	return [1, 4, 2][button] || 0;
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
	.toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto 28px;
		gap: 6px;
		padding: 8px;
		border-bottom: 1px solid var(--vscode-panel-border);
		background: var(--vscode-sideBar-background);
	}
	select,
	button {
		min-width: 0;
		height: 28px;
		font: inherit;
		border-radius: 2px;
		outline: none;
	}
	select {
		color: var(--vscode-dropdown-foreground);
		background: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
		padding: 0 6px;
	}
	button {
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
		border: 1px solid var(--vscode-button-border, transparent);
		padding: 0 10px;
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
	.icon-button {
		padding: 0;
		font-size: 16px;
		line-height: 1;
		color: var(--vscode-icon-foreground);
		background: transparent;
		border-color: transparent;
	}
	.icon-button:hover:not(:disabled) {
		color: var(--vscode-foreground);
		background: var(--vscode-toolbar-hoverBackground);
	}
	.stage {
		min-height: 0;
		min-width: 0;
		display: grid;
		place-items: center;
		overflow: hidden;
		padding: 8px;
		background: var(--vscode-editor-background);
	}
	#screen {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		touch-action: none;
		user-select: none;
		outline: none;
	}
	#screen:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.empty {
		display: grid;
		gap: 6px;
		justify-items: center;
		padding: 16px;
		color: var(--vscode-descriptionForeground);
		text-align: center;
	}
	.empty-title {
		color: var(--vscode-foreground);
		font-weight: 600;
	}
	.status {
		min-height: 24px;
		padding: 5px 8px;
		border-top: 1px solid var(--vscode-panel-border);
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	.status.online { color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground)); }
	.status.error { color: var(--vscode-errorForeground); }
`;
document.head.append(style);

const root = document.getElementById('root');
if (root) {
	createRoot(root).render(<App />);
}
