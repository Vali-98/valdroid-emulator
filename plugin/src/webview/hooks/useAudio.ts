import * as React from 'react';
import type { DeviceVolume, ServerStatus } from '../../shared/protocol';
import { useDeviceQuery } from '../api';
import { startAudio, type AudioStatus, type AudioStream } from '../audio';

export function useAudio(serverUrl: string) {
	const contextRef = React.useRef<AudioContext | undefined>(undefined);
	const streamRef = React.useRef<AudioStream | undefined>(undefined);
	const [status, setStatus] = React.useState<AudioStatus>({ state: 'off', detail: 'Waiting for Android audio' });
	const volume = useDeviceQuery<DeviceVolume>(serverUrl, '/api/volume', 10000);
	const serverStatus = useDeviceQuery<ServerStatus>(serverUrl, '/api/status', 3000);
	const update = React.useCallback((change: Partial<AudioStatus>) => setStatus(previous => {
		const next = { ...previous, ...change };
		return next.state === previous.state && next.detail === previous.detail ? previous : next;
	}), []);
	const getContext = React.useCallback(() => {
		contextRef.current ??= new AudioContext({ sampleRate: 48000 });
		return contextRef.current;
	}, []);
	const resume = React.useCallback(() => {
		const context = getContext();
		if (context.state === 'suspended') {void context.resume().catch(error => update({ state: 'error', detail: String(error) }));}
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

	// Reuse an in-flight query rather than cancel/relaunch an Android process.
	const refreshVolume = () => volume.refetch({ cancelRefetch: false });
	return { ...status, resume, refreshVolume };
}
