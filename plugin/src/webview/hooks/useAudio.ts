import * as React from 'react';
import type { DeviceVolume, ServerStatus } from '../../shared/protocol';
import { useDeviceQuery } from '../api';
import { startAudio, type AudioStatus, type AudioStream } from '../audio';

export function useAudio(serverUrl: string) {
	const contextRef = React.useRef<AudioContext | undefined>(undefined);
	const streamRef = React.useRef<AudioStream | undefined>(undefined);
	const [status, setStatus] = React.useState<AudioStatus>({ state: 'off', detail: 'Waiting for Android audio' });
	const volume = useDeviceQuery<DeviceVolume>(serverUrl, '/api/volume', 1000);
	const serverStatus = useDeviceQuery<ServerStatus>(serverUrl, '/api/status', 3000);
	const update = React.useCallback((change: Partial<AudioStatus>) => setStatus(previous => ({ ...previous, ...change })), []);
	const getContext = React.useCallback(() => {
		contextRef.current ??= new AudioContext({ sampleRate: 48000 });
		return contextRef.current;
	}, []);
	const resume = React.useCallback(() => {
		void getContext().resume().catch(error => update({ state: 'error', detail: String(error) }));
	}, [getContext, update]);

	React.useEffect(() => {
		if (!serverUrl) {return;}
		const stream = startAudio(serverUrl, getContext(), update);
		streamRef.current = stream;
		return () => {stream.stop(); streamRef.current = undefined;};
	}, [serverUrl, getContext, update]);
	React.useEffect(() => {
		if (volume.data) {streamRef.current?.setVolume(volume.data);}
		if (serverStatus.data) {streamRef.current?.updateServerStatus(serverStatus.data);}
	}, [volume.data, serverStatus.data, serverStatus.dataUpdatedAt]);
	React.useEffect(() => () => {
		const context = contextRef.current;
		contextRef.current = undefined;
		if (context && context.state !== 'closed') {void context.close();}
	}, []);

	return { ...status, resume, refreshVolume: volume.refetch };
}
