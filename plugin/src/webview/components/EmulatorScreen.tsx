import * as React from 'react';
import { startAVCVideo } from '../avcVideo';

export function EmulatorScreen({ serverUrl, imageRef, screenProps }: {
	serverUrl: string;
	imageRef: React.RefObject<HTMLCanvasElement | null>;
	screenProps: React.HTMLAttributes<HTMLCanvasElement>;
}) {
	const [status, setStatus] = React.useState('Starting AVC playback…');
	const [attempt, restart] = React.useReducer(value => value + 1, 0);
	React.useEffect(() => {
		const screen = imageRef.current;
		if (screen) {return startAVCVideo(serverUrl, screen, setStatus, setStatus);}
	}, [serverUrl, imageRef, attempt]);
	const props = { ...screenProps, id: 'screen', 'aria-label': 'Android emulator display', draggable: false, tabIndex: 0 };
	return <div className="screen-frame">
		<canvas {...props} ref={imageRef} width={0} height={0} />
		<div className="video-status" role="status">{status} <button onClick={restart}>Restart playback</button></div>
	</div>;
}
