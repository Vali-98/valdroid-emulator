import type * as React from 'react';

export function EmulatorScreen({ serverUrl, imageRef, screenProps }: {
	serverUrl: string;
	imageRef: React.RefObject<HTMLImageElement | null>;
	screenProps: React.ImgHTMLAttributes<HTMLImageElement>;
}) {
	return <div className="screen-frame"><img {...screenProps}
		ref={imageRef}
		id="screen"
		src={`${serverUrl}/stream`}
		alt="Android emulator display"
		draggable={false}
		tabIndex={0}
	/></div>;
}
