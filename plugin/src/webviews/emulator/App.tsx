import * as React from 'react';
import type { DisplayState, StatusMessage } from '../../shared/protocol';
import { useDeviceQuery } from './api';
import { Header } from './components/Header';
import { DevicePicker, LoadingState } from './components/DevicePicker';
import { DeviceRail } from './components/DeviceRail';
import { EmulatorScreen } from './components/EmulatorScreen';
import { StatusBar } from './components/StatusBar';
import { TransferFeedback } from './components/TransferFeedback';
import { useAudio } from './hooks/useAudio';
import { useControlConnection } from './hooks/useControlConnection';
import { useFileDrop } from './hooks/useFileDrop';
import { useHostSession } from './hooks/useHostSession';
import type { VideoStats } from './media/avcVideo';
import { Toast, type ToastNotice } from './components/Toast';
import {useElementInspector} from './components/ElementInspector';

const initialDisplay: DisplayState = { id: 0, width: 0, height: 0, orientation: 0 };

function EmulatorWorkspace({ serverUrl, session, audio, onClose, onRetry, startedAt, notice, onDismissNotice, host }: {
	host: ReturnType<typeof useHostSession>;
	serverUrl: string;
	session: StatusMessage;
	audio: ReturnType<typeof useAudio>;
	onClose: () => void;
	onRetry: () => void;
	startedAt?: number;
	notice?: ToastNotice;
	onDismissNotice: () => void;
}) {
	const [debugVisible, setDebugVisible] = React.useState(false);
	const [videoStatus, setVideoStatus] = React.useState('Connecting…');
	const [videoStats, setVideoStats] = React.useState<VideoStats>();
	const [initialized, setInitialized] = React.useState(false);
	const reportVideoStatus = React.useCallback((status: string) => {
		setVideoStatus(status); if (status === 'Playing') {setInitialized(true);}
	}, []);
	const [attempt, restart] = React.useReducer(value => value + 1, 0);
	const restartVideo = () => {setVideoStats(undefined); restart();};
	const { data: display = initialDisplay } = useDeviceQuery<DisplayState>(serverUrl, '/api/display-state?display=0', 500);
	const control = useControlConnection(serverUrl, audio.refreshVolume);
	const fileDrop = useFileDrop();
	const inspector = useElementInspector(host.devtools.active);
	return <div {...fileDrop.rootProps} className="app" onPointerDownCapture={audio.resume} onKeyDownCapture={audio.resume}>
		<input {...fileDrop.inputProps} />
		<Header title={session.deviceName || 'Emulator Loaded'} loaded debugVisible={debugVisible}
			busy={host.launch.busy} onLifecycle={host.lifecycle}
			onDebuggingChange={host.setDebugging}
			onShowDevMenu={host.showDevMenu}
			inspecting={inspector.selecting} onToggleInspector={inspector.toggle}
			devtools={host.devtools} onToggleScan={host.toggleScan}
			onToggleDebug={() => setDebugVisible(value => !value)} onClose={onClose} />
		<main className="stage">
			<DeviceRail onKey={control.sendDeviceKey} />
			<EmulatorScreen serverUrl={serverUrl} display={display} send={control.send} status={videoStatus} onStatus={reportVideoStatus}
				debuggerPaused={host.devtools.debugger?.attached && host.devtools.debugger.paused} onDebugger={host.debuggerAction}
				launchStatus={host.launch.busy ? host.launch.status : undefined}
				inspector={inspector}
				scanEnabled={host.devtools.active && host.devtools.enabled}
				onStats={setVideoStats} attempt={attempt} onRestart={restartVideo} onRetry={onRetry} startedAt={initialized ? undefined : startedAt} />
			<TransferFeedback dragging={fileDrop.dragging} notice={notice ?? fileDrop.notice} onDismiss={notice ? onDismissNotice : fileDrop.dismissNotice} />
		</main>
		{debugVisible && <StatusBar status={control.status} state={session.state} display={display} audio={audio}
			serverUrl={serverUrl} videoStatus={videoStatus} video={videoStats} onRestart={restartVideo} />}
	</div>;
}

export function App() {
	const host = useHostSession();
	const serverUrl = host.session.serverUrl ?? '';
	const audio = useAudio(serverUrl);
	const notice: ToastNotice | undefined = host.notice ? {message: host.notice.message, phase: host.notice.level, startedAt: host.notice.id} : undefined;
	if (serverUrl) {
		return <EmulatorWorkspace host={host} key={serverUrl} serverUrl={serverUrl} session={host.session} audio={audio} onClose={host.close}
			onRetry={host.retry} startedAt={host.loadingStartedAt} notice={notice} onDismissNotice={host.dismissNotice} />;
	}
	return <div className="app">
		<Header title="No Emulator Loaded" loaded={false} />
		<main className="stage stage-idle">
			<div className="idle-phone">
			{host.launch.busy || host.session.state === 'online' ? <LoadingState status={host.launch.busy ? host.launch.status : host.session.status} startedAt={host.loadingStartedAt} onRetry={host.launch.busy ? undefined : host.retry} /> : <DevicePicker
				targets={host.targets} selected={host.selectedTarget} onSelect={host.selectTarget} onRefresh={host.refreshTargets}
				onStart={() => {audio.resume(); host.start();}}
				project={host.project} onStartExpo={host.project.expo ? () => {audio.resume(); host.startExpo();} : undefined}
				launchWithExpo={host.launchWithExpo} onLaunchWithExpoChange={host.setLaunchWithExpo}
			/>}
			</div>
			{notice && <Toast key={host.notice!.id} notice={notice} onDismiss={host.dismissNotice} />}
		</main>
	</div>;
}
