import * as React from 'react';
import type { DisplayState } from '../../shared/protocol';
import { androidKeyCode, mapScreenPoint, metaState } from '../input';

export function useEmulatorInput(display: DisplayState, send: (command: object) => boolean) {
	const imageRef = React.useRef<HTMLImageElement>(null);
	const pointerIdRef = React.useRef<number | null>(null);
	const sendMotion = (event: React.PointerEvent | React.WheelEvent, action: number, axes: Array<{ axis: number; value: number }> = []) => {
		const image = imageRef.current;
		const point = image && mapScreenPoint(image, display, event.clientX, event.clientY);
		if (!point) {return;}
		send({ type: 'motion', pointers: [{ ...point, id: 0, axes }], action,
			buttonState: 0, actionButton: 0, displayId: display.id, isMouse: false });
	};
	const release = (event: React.PointerEvent<HTMLImageElement>) => {
		if (event.pointerId !== pointerIdRef.current) {return;}
		sendMotion(event, 1);
		pointerIdRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {event.currentTarget.releasePointerCapture(event.pointerId);}
	};
	const sendKey = (event: React.KeyboardEvent, action: number) => {
		const keyCode = androidKeyCode(event.key);
		if (keyCode && send({ type: 'key', action, keyCode, metaState: metaState(event) })) {event.preventDefault();}
	};
	const screenProps: React.ImgHTMLAttributes<HTMLImageElement> = {
		onPointerDown: event => {
			const image = imageRef.current;
			if (!image || pointerIdRef.current !== null || (event.pointerType === 'mouse' && event.button !== 0)
				|| !mapScreenPoint(image, display, event.clientX, event.clientY, false)) {return;}
			event.preventDefault();
			event.currentTarget.focus({ preventScroll: true });
			event.currentTarget.setPointerCapture(event.pointerId);
			pointerIdRef.current = event.pointerId;
			sendMotion(event, 0);
		},
		onPointerMove: event => {
			if (event.pointerId !== pointerIdRef.current) {return;}
			if (event.pointerType === 'mouse' && event.buttons === 0) {release(event); return;}
			sendMotion(event, 2);
		},
		onPointerUp: release,
		onPointerCancel: release,
		onLostPointerCapture: release,
		onWheel: event => {
			event.preventDefault();
			sendMotion(event, 8, [{ axis: 9, value: -event.deltaY }, { axis: 10, value: event.deltaX }]);
		},
		onKeyDown: event => sendKey(event, 0),
		onKeyUp: event => sendKey(event, 1),
		onContextMenu: event => event.preventDefault(),
	};
	return { imageRef, screenProps };
}
