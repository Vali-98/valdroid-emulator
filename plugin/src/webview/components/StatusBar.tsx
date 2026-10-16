import type { DisplayState, SessionState } from '../../shared/protocol';
import type { AudioStatus } from '../audio';
import type { VideoStats } from '../avcVideo';
import { useDeviceQuery } from '../api';
import * as React from 'react';

type Resources = { pid: number; sampledAtMs: number; cpuTimeNs?: number; heapAllocBytes: number; heapReservedBytes: number; goroutines: number; gcCycles: number };
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;

function ServerResources({ serverUrl }: { serverUrl: string }) {
	const { data, isError } = useDeviceQuery<Resources>(serverUrl, '/api/resources', 2000);
	const previous = React.useRef<Resources | undefined>(undefined);
	const [cpu, setCPU] = React.useState<number>();
	React.useEffect(() => {
		const before = previous.current;
		if (data && before && data.pid === before.pid && data.cpuTimeNs !== undefined && before.cpuTimeNs !== undefined && data.sampledAtMs > before.sampledAtMs && data.cpuTimeNs >= before.cpuTimeNs) {
			setCPU((data.cpuTimeNs - before.cpuTimeNs) / ((data.sampledAtMs - before.sampledAtMs) * 1e6) * 100);
		} else {setCPU(undefined);}
		previous.current = data;
	}, [data]);
	if (!data || isError) {return <div>Server resources: {isError ? 'unavailable' : 'loading…'}</div>;}
	return <>
		<div>Server CPU: {cpu === undefined ? '—' : `${cpu.toFixed(1)}%`} <small>(one core)</small></div>
		<div>Server heap: {mib(data.heapAllocBytes)} used · {mib(data.heapReservedBytes)} reserved</div>
		<div>Goroutines: {data.goroutines} · GC cycles: {data.gcCycles}</div>
	</>;
}

export function StatusBar({ status, state, display, audio, serverUrl, videoStatus, video, onRestart }: {
	status: string;
	state: SessionState;
	display: DisplayState;
	audio: AudioStatus;
	serverUrl: string;
	videoStatus: string;
	video?: VideoStats;
	onRestart: () => void;
}) {
	const displayMeta = display.width > 0 && display.height > 0 ? `${display.width}x${display.height} · rotation ${display.orientation}` : '';
	return <footer className="bottombar" aria-label="Debug info"><div className="debug-details"><div className={`status ${state}`}>
		{[status, displayMeta].filter(Boolean).join(' · ')}
		<span className={audio.state === 'error' ? 'audio-error' : ''}> · {audio.detail}</span>
	</div>
		<div>Playback: {videoStatus}</div>
		{video && <>
			<div>FPS: {video.fps.toFixed(1)} · Decoder queue: {video.queue}</div>
			<div title="Time from server receipt to canvas draw; excludes device encoding and display scanout">Frame age: {video.ageMeanMs.toFixed(1)} ms mean · {video.ageP95Ms.toFixed(1)} ms p95</div>
			<div>Frames: {video.decoded} decoded · {video.presented} painted · {video.replaced} superseded</div>
		</>}
		<ServerResources serverUrl={serverUrl} />
		<button type="button" onClick={onRestart}>Restart playback</button>
	</div></footer>;
}
