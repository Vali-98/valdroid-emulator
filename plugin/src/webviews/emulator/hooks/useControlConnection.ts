import * as React from 'react';
import { socketUrl } from '../api';
import { createControlSender } from '../input/controlSender';

export function useControlConnection(serverUrl: string, refreshVolume: () => unknown) {
	const senderRef = React.useRef<ReturnType<typeof createControlSender> | undefined>(undefined);
	const volumeTimerRef = React.useRef<number | undefined>(undefined);
	const [status, setStatus] = React.useState('Connecting to emulator');
	React.useEffect(() => {
		const socket = new WebSocket(socketUrl(serverUrl, '/control'));
		const sender = createControlSender(socket);
		senderRef.current = sender;
		socket.onopen = () => setStatus('Emulator connected');
		socket.onclose = () => {window.clearTimeout(volumeTimerRef.current); setStatus('Input connection closed');};
		socket.onerror = () => setStatus('Input connection failed');
		return () => {
			window.clearTimeout(volumeTimerRef.current);
			sender.dispose(); senderRef.current = undefined;
			socket.onopen = socket.onclose = socket.onerror = null;
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
