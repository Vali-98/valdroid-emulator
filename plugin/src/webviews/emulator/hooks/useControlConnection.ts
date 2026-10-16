import * as React from 'react';
import { socketUrl } from '../api';
import { createControlSender } from '../input/controlSender';
import { vscode } from '../../shared/vscode';

export function useControlConnection(serverUrl: string, refreshVolume: () => unknown) {
	const senderRef = React.useRef<ReturnType<typeof createControlSender> | undefined>(undefined);
	const volumeTimerRef = React.useRef<number | undefined>(undefined);
	const [status, setStatus] = React.useState('Connecting to emulator');
	React.useEffect(() => {
		const socket = new WebSocket(socketUrl(serverUrl, '/control'));
		const sender = createControlSender(socket);
		senderRef.current = sender;
		socket.onopen = () => setStatus('Emulator connected');
		let reported = false;
		const fail = (message: string) => {
			window.clearTimeout(volumeTimerRef.current); setStatus(message);
			if (!reported) {reported = true; vscode.postMessage({type: 'client-error', serverUrl, message, fatal: true});}
		};
		socket.onclose = () => fail('Input connection closed');
		socket.onerror = () => fail('Input connection failed');
		let lastError = '';
		socket.onmessage = event => {
			try {
				const reply = JSON.parse(String(event.data));
				if (typeof reply.error === 'string' && reply.error !== lastError) {
					lastError = reply.error;
					vscode.postMessage({type: 'client-error', serverUrl, message: reply.error, fatal: false});
				}
			} catch { /* Ignore messages outside the control reply protocol. */ }
		};
		return () => {
			window.clearTimeout(volumeTimerRef.current);
			sender.dispose(); senderRef.current = undefined;
			socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
			socket.close();
		};
	}, [serverUrl]);
	const send = React.useCallback((command: object): boolean => {
		return senderRef.current?.send(command) ?? false;
	}, []);
	const sendDeviceKey = (keyCode: number) => {
		if (send({ type: 'key', action: 8, keyCode, metaState: 0 }) && [24, 25, 164].includes(keyCode)) {
			window.clearTimeout(volumeTimerRef.current);
			volumeTimerRef.current = window.setTimeout(() => {void refreshVolume();}, 300);
		}
	};
	return { status, send, sendDeviceKey };
}
