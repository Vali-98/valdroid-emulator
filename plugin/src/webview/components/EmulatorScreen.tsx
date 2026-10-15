import * as React from 'react';
import { startVideo } from '../video';

export function EmulatorScreen({ serverUrl, imageRef, screenProps }: {
	serverUrl: string;
	imageRef: React.RefObject<HTMLCanvasElement | null>;
	screenProps: React.CanvasHTMLAttributes<HTMLCanvasElement>;
}) {
	React.useEffect(() => {
		const image = imageRef.current;
		if (image) {return startVideo(serverUrl, image);}
	}, [serverUrl, imageRef]);
	return <div className="screen-frame"><canvas {...screenProps}
		ref={imageRef}
		id="screen"
		aria-label="Android emulator display"
		width={0}
		height={0}
		draggable={false}
		tabIndex={0}
	/></div>;
}
