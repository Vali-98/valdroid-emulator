import * as React from 'react';
import type { DisplayState } from '../../../shared/protocol';
import { startAVCVideo, type VideoStats } from '../media/avcVideo';
import { useEmulatorInput } from '../hooks/useEmulatorInput';

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
		const stop = startAVCVideo(serverUrl, screen, onStatus, onStatus, onStats);
		return () => {stop(); imageRef.current = null;};
	}, [serverUrl, imageRef, onStatus, onStats]);
	return <canvas {...screenProps} ref={attachScreen} width={0} height={0}
		id="screen" aria-label="Android emulator display" draggable={false} tabIndex={0} />;
}

export function EmulatorScreen({status, attempt, onRestart, ...playback}: PlaybackProps & {
	status: string;
	attempt: number;
	onRestart: () => void;
}) {
	return <div className="screen-frame">
		<PlaybackCanvas key={attempt} {...playback} />
		{status !== 'Playing' && <div className="video-status" role="status">{status} <button onClick={onRestart}>Restart playback</button></div>}
	</div>;
}
