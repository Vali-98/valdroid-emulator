import * as React from 'react';
import type { DisplayState } from '../../../shared/protocol';
import { startAVCVideo, type VideoStats } from '../media/avcVideo';
import { useEmulatorInput } from '../hooks/useEmulatorInput';
import { LoadingState } from './DevicePicker';
import { vscode } from '../../shared/vscode';
import { ScanOverlay } from './ScanOverlay';

interface PlaybackProps {
	serverUrl: string;
	display: DisplayState;
	send: (command: object) => boolean;
	onStatus: (status: string) => void;
	onStats: (stats: VideoStats | undefined) => void;
}

// One mounted canvas owns playback and input. Metadata updates do not restart it.
function PlaybackCanvas({serverUrl, display, send, onStatus, onStats}: PlaybackProps) {
	const {imageRef, screenProps} = useEmulatorInput(display, send);
	const attachScreen = React.useCallback((screen: HTMLCanvasElement | null) => {
		imageRef.current = screen;
		if (!screen) {return;}
		const stop = startAVCVideo(serverUrl, screen, onStatus, reason => {
			onStatus(reason);
			vscode.postMessage({type: 'client-error', serverUrl, message: reason, fatal: true});
		}, onStats);
		return () => {stop(); imageRef.current = null;};
	}, [serverUrl, imageRef, onStatus, onStats]);
	return <canvas {...screenProps} ref={attachScreen} width={0} height={0}
		id="screen" aria-label="Android emulator display" draggable={false} tabIndex={0} />;
}

export function EmulatorScreen({status, attempt, onRestart, startedAt, onRetry, scanEnabled = false, launchStatus, ...playback}: PlaybackProps & {
	launchStatus?: string;
	scanEnabled?: boolean;
	status: string;
	attempt: number;
	onRestart: () => void;
	startedAt?: number;
	onRetry?: () => void;
}) {
	return <div className="screen-frame">
		<PlaybackCanvas key={attempt} {...playback} />
		<ScanOverlay enabled={scanEnabled} />
		{(status !== 'Playing' || launchStatus) && <LoadingState status={launchStatus ?? status} startedAt={startedAt} onRetry={launchStatus ? undefined : onRetry ?? onRestart} />}
	</div>;
}
