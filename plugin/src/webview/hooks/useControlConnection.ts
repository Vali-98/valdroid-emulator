import * as React from 'react';
import { socketUrl } from '../api';

export function useControlConnection(serverUrl: string, refreshVolume: () => unknown) {
	const socketRef = React.useRef<WebSocket | undefined>(undefined);
	const volumeTimerRef = React.useRef<number | undefined>(undefined);
	const [status, setStatus] = React.useState('Connecting to emulator');
	React.useEffect(() => {
		const socket = new WebSocket(socketUrl(serverUrl, '/control'));
		socketRef.current = socket;
		socket.onopen = () => setStatus('Emulator connected');
		socket.onclose = () => setStatus('Input connection closed');
		socket.onerror = () => setStatus('Input connection failed');
		return () => {
			window.clearTimeout(volumeTimerRef.current);
			socket.onopen = socket.onclose = socket.onerror = null;
			socket.close();
			socketRef.current = undefined;
		};
	}, [serverUrl]);
	const send = React.useCallback((command: object): boolean => {
		const socket = socketRef.current;
		if (socket?.readyState !== WebSocket.OPEN) {return false;}
		socket.send(JSON.stringify(command));
		return true;
	}, []);
	const sendDeviceKey = (keyCode: number) => {
		if (send({ type: 'key', action: 8, keyCode, metaState: 0 }) && [24, 25, 164].includes(keyCode)) {
			window.clearTimeout(volumeTimerRef.current);
			volumeTimerRef.current = window.setTimeout(() => {void refreshVolume();}, 300);
		}
	};
	return { status, send, sendDeviceKey };
}
