import type {ReactNode, ComponentProps, CSSProperties} from 'react';
import type {DisplayState} from '../../../shared/protocol';
import {LoadingState} from './DevicePicker';

export function phoneDimensions(display?: DisplayState): CSSProperties {
	let width = display?.width && display.height ? display.width : 9;
	let height = display?.width && display.height ? display.height : 19.5;
	const rotated = display && ((display.orientation + (display.orientationCorrection ?? 0)) % 2 !== 0);
	if (rotated) {[width, height] = [height, width];}
	return {'--phone-ratio': width / height, '--phone-inverse-ratio': height / width} as CSSProperties;
}
export function PhoneFrame({children, display}: {children: ReactNode; display?: DisplayState}) {
	return <div className="phone-frame" style={phoneDimensions(display)}>{children}</div>;
}

// Use the stage's dimensions, not the live video's letterbox, for every loader.
export function PhoneLoading({display, ...props}: ComponentProps<typeof LoadingState> & {display?: DisplayState}) {
	return <div className="phone-loading-layer"><PhoneFrame display={display}><LoadingState {...props} /></PhoneFrame></div>;
}
