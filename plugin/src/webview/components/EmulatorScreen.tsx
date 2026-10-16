import * as React from 'react';
import { startAVCVideo, type VideoStats } from '../avcVideo';

export function EmulatorScreen({ serverUrl, imageRef, screenProps, status, onStatus, onStats, attempt, onRestart }: {
	serverUrl: string;
	imageRef: React.RefObject<HTMLCanvasElement | null>;
	screenProps: React.HTMLAttributes<HTMLCanvasElement>;
	status: string;
	onStatus: (status: string) => void;
	onStats: (stats: VideoStats | undefined) => void;
	attempt: number;
	onRestart: () => void;
}) {
	React.useEffect(() => {
		const screen = imageRef.current;
		if (screen) {return startAVCVideo(serverUrl, screen, onStatus, onStatus, onStats);}
	}, [serverUrl, imageRef, attempt, onStatus, onStats]);
	const props = { ...screenProps, id: 'screen', 'aria-label': 'Android emulator display', draggable: false, tabIndex: 0 };
	return <div className="screen-frame">
		<canvas {...props} ref={imageRef} width={0} height={0} />
		{status !== 'Playing' && <div className="video-status" role="status">{status} <button onClick={onRestart}>Restart playback</button></div>}
	</div>;
}
