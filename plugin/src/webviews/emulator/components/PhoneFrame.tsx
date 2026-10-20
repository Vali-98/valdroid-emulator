import type {ReactNode, ComponentProps} from 'react';
import {LoadingState} from './DevicePicker';

export function PhoneFrame({children}: {children: ReactNode}) {
	return <div className="phone-frame">{children}</div>;
}

// Use the stage's dimensions, not the live video's letterbox, for every loader.
export function PhoneLoading(props: ComponentProps<typeof LoadingState>) {
	return <div className="phone-loading-layer"><PhoneFrame><LoadingState {...props} /></PhoneFrame></div>;
}
