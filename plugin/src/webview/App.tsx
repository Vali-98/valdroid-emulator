import * as React from 'react';
import type { DisplayState, StatusMessage } from '../shared/protocol';
import { useDeviceQuery } from './api';
import { Header } from './components/Header';
import { DevicePicker, LoadingState } from './components/DevicePicker';
import { DeviceRail } from './components/DeviceRail';
import { EmulatorScreen } from './components/EmulatorScreen';
import { StatusBar } from './components/StatusBar';
import { TransferFeedback } from './components/TransferFeedback';
import { useAudio } from './hooks/useAudio';
import { useControlConnection } from './hooks/useControlConnection';
import { useEmulatorInput } from './hooks/useEmulatorInput';
import { useFileDrop } from './hooks/useFileDrop';
import { useHostSession } from './hooks/useHostSession';
import type { VideoStats } from './avcVideo';

const initialDisplay: DisplayState = { id: 0, width: 0, height: 0, orientation: 0 };

function EmulatorWorkspace({ serverUrl, session, audio, onClose }: {
	serverUrl: string;
	session: StatusMessage;
	audio: ReturnType<typeof useAudio>;
	onClose: () => void;
}) {
	const [debugVisible, setDebugVisible] = React.useState(false);
	const [videoStatus, setVideoStatus] = React.useState('Connecting…');
	const [videoStats, setVideoStats] = React.useState<VideoStats>();
	const [attempt, restart] = React.useReducer(value => value + 1, 0);
	const restartVideo = () => {setVideoStats(undefined); restart();};
	const { data: display = initialDisplay } = useDeviceQuery<DisplayState>(serverUrl, '/api/display-state?display=0', 500);
	const control = useControlConnection(serverUrl, audio.refreshVolume);
	const input = useEmulatorInput(display, control.send);
	const fileDrop = useFileDrop();
	return <div {...fileDrop.rootProps} className="app" onPointerDownCapture={audio.resume} onKeyDownCapture={audio.resume}>
		<input {...fileDrop.inputProps} />
		<Header title={session.deviceName || 'Emulator Loaded'} loaded debugVisible={debugVisible}
			onToggleDebug={() => setDebugVisible(value => !value)} onClose={onClose} />
		<main className="stage">
			<DeviceRail onKey={control.sendDeviceKey} />
			<EmulatorScreen serverUrl={serverUrl} {...input} status={videoStatus} onStatus={setVideoStatus}
				onStats={setVideoStats} attempt={attempt} onRestart={restartVideo} />
			<TransferFeedback dragging={fileDrop.dragging} notice={fileDrop.notice} onDismiss={fileDrop.dismissNotice} />
		</main>
		{debugVisible && <StatusBar status={control.status} state={session.state} display={display} audio={audio}
			serverUrl={serverUrl} videoStatus={videoStatus} video={videoStats} onRestart={restartVideo} />}
	</div>;
}

export function App() {
	const host = useHostSession();
	const serverUrl = host.session.serverUrl ?? '';
	const audio = useAudio(serverUrl);
	if (serverUrl) {
		return <EmulatorWorkspace key={serverUrl} serverUrl={serverUrl} session={host.session} audio={audio} onClose={host.close} />;
	}
	return <div className="app">
		<Header title="No Emulator Loaded" loaded={false} />
		<main className="stage stage-idle">
			<div className="idle-phone">
			{host.session.state === 'online' ? <LoadingState status={host.session.status} /> : <DevicePicker
				targets={host.targets} selected={host.selectedTarget} onSelect={host.selectTarget} onRefresh={host.refreshTargets}
				onStart={() => {audio.resume(); host.start();}} error={host.session.state === 'error' ? host.session.status : undefined}
			/>}
			</div>
		</main>
	</div>;
}
