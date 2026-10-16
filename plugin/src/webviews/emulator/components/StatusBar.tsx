import type { DisplayState, SessionState } from '../../../shared/protocol';
import type { AudioStatus } from '../media/audio';
import type { VideoStats } from '../media/avcVideo';
import { useServerResources } from '../hooks/useServerResources';

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;

function ServerResources({ serverUrl }: { serverUrl: string }) {
	const { data, isError } = useServerResources(serverUrl);
	if (!data || isError) {return <div>Server resources: {isError ? 'unavailable' : 'loading…'}</div>;}
	return <>
		<div>Server CPU: {data.cpuPercent === undefined ? '—' : `${data.cpuPercent.toFixed(1)}%`} <small>(one core)</small></div>
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
