import * as React from 'react';
import type { DisplayState } from '../../shared/protocol';
import { androidKeyCode, mapScreenPoint, metaState } from '../input';

export function useEmulatorInput(display: DisplayState, send: (command: object) => boolean) {
	const imageRef = React.useRef<HTMLCanvasElement>(null);
	const pointerIdRef = React.useRef<number | null>(null);
	const rawInputRef = React.useRef(false);
	const sendMotion = (event: { clientX: number; clientY: number }, action: number, axes: Array<{ axis: number; value: number }> = [], mapped?: { x: number; y: number }) => {
		const image = imageRef.current;
		const point = mapped ?? (image && mapScreenPoint(image, display, event.clientX, event.clientY));
		if (!point) {return false;}
		return send({ type: 'motion', pointers: [{ ...point, id: 0, axes }], action,
			buttonState: 0, actionButton: 0, displayId: display.id, isMouse: false });
	};
	const release = (event: { pointerId: number; clientX: number; clientY: number }, action = 1) => {
		if (event.pointerId !== pointerIdRef.current) {return;}
		sendMotion(event, action);
		pointerIdRef.current = null;
		const image = imageRef.current;
		if (image?.hasPointerCapture(event.pointerId)) {image.releasePointerCapture(event.pointerId);}
	};
	const move = (event: { pointerId: number; clientX: number; clientY: number; pointerType: string; buttons: number }) => {
		if (event.pointerId !== pointerIdRef.current) {return;}
		if (event.pointerType === 'mouse' && event.buttons === 0) {release(event); return;}
		sendMotion(event, 2);
	};
	const rawMove = React.useEffectEvent((event: PointerEvent) => move(event));
	React.useEffect(() => {
		const image = imageRef.current;
		if (!image || !('onpointerrawupdate' in image)) {return;}
		const receive = (event: Event) => {rawInputRef.current = true; rawMove(event as PointerEvent);};
		image.addEventListener('pointerrawupdate', receive, { passive: true });
		return () => {rawInputRef.current = false; image.removeEventListener('pointerrawupdate', receive);};
	}, []);
	const sendKey = (event: React.KeyboardEvent, action: number) => {
		const keyCode = androidKeyCode(event.key);
		if (keyCode && send({ type: 'key', action, keyCode, metaState: metaState(event) })) {event.preventDefault();}
	};
	const screenProps: React.HTMLAttributes<HTMLCanvasElement> = {
		onPointerDown: event => {
			const image = imageRef.current;
			if (!image || pointerIdRef.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) {return;}
			const point = mapScreenPoint(image, display, event.clientX, event.clientY, false);
			if (!point) {return;}
			event.preventDefault();
			if (!sendMotion(event, 0, [], point)) {return;}
			pointerIdRef.current = event.pointerId;
			event.currentTarget.focus({ preventScroll: true });
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		onPointerMove: event => {
			if (!rawInputRef.current) {move(event);}
		},
		onPointerUp: event => release(event),
		onPointerCancel: event => release(event, 3),
		onLostPointerCapture: event => release(event, 3),
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
