import * as React from 'react';
import type { DisplayState } from '../../../shared/protocol';
import { androidKeyCode, mapScreenPoint, metaState } from '../input/input';
import {vscode} from '../../shared/vscode';

export function useEmulatorInput(display: DisplayState, send: (command: object) => boolean) {
	const imageRef = React.useRef<HTMLCanvasElement>(null);
	const pasteRequest = React.useRef<string | undefined>(undefined);
	const paste = React.useEffectEvent((event: MessageEvent) => {
		if (event.data?.type !== 'clipboard-text' || !pasteRequest.current || event.data.id !== pasteRequest.current) {return;}
		pasteRequest.current = undefined;
		if (document.activeElement === imageRef.current && typeof event.data.text === 'string' && event.data.text) {send({type: 'paste', text: event.data.text});}
	});
	React.useEffect(() => {
		const receive = (event: MessageEvent) => paste(event);
		const cancel = () => {pasteRequest.current = undefined;};
		window.addEventListener('message', receive);
		window.addEventListener('blur', cancel);
		return () => {cancel(); window.removeEventListener('message', receive); window.removeEventListener('blur', cancel);};
	}, []);
	const pointerIdRef = React.useRef<number | null>(null);
	const rawInputRef = React.useRef(false);
	const lastPointRef = React.useRef<{x: number; y: number} | null>(null);
	const sendMotion = React.useCallback((event: { clientX: number; clientY: number }, action: number, axes: Array<{ axis: number; value: number }> = [], mapped?: { x: number; y: number }) => {
		const image = imageRef.current;
		const point = mapped ?? (image && mapScreenPoint(image, display, event.clientX, event.clientY));
		if (!point) {return false;}
		lastPointRef.current = point;
		return send({ type: 'motion', pointers: [{ ...point, id: 0, axes }], action,
			buttonState: 0, actionButton: 0, displayId: display.id, isMouse: false });
	}, [display, send]);
	const release = React.useCallback((event: { pointerId: number; clientX: number; clientY: number }, action = 1) => {
		if (event.pointerId !== pointerIdRef.current) {return;}
		sendMotion(event, action);
		pointerIdRef.current = null;
		const image = imageRef.current;
		if (image?.hasPointerCapture(event.pointerId)) {image.releasePointerCapture(event.pointerId);}
	}, [sendMotion]);
	const move = React.useCallback((event: { pointerId: number; clientX: number; clientY: number; pointerType: string; buttons: number }) => {
		if (event.pointerId !== pointerIdRef.current) {return;}
		if (event.pointerType === 'mouse' && event.buttons === 0) {release(event); return;}
		sendMotion(event, 2);
	}, [release, sendMotion]);
	const rawMove = React.useEffectEvent((event: PointerEvent) => move(event));
	const cancelGesture = React.useEffectEvent(() => {
		if (pointerIdRef.current !== null && lastPointRef.current) {sendMotion({clientX: 0, clientY: 0}, 3, [], lastPointRef.current);}
		pointerIdRef.current = null;
	});
	// Own the native listener for this canvas; use current mapping without reconnecting video.
	React.useEffect(() => {
		const image = imageRef.current;
		if (!image) {return;}
		const receive = (event: Event) => {rawInputRef.current = true; rawMove(event as PointerEvent);};
		if ('onpointerrawupdate' in image) {image.addEventListener('pointerrawupdate', receive, { passive: true });}
		return () => {
			cancelGesture(); rawInputRef.current = false;
			image.removeEventListener('pointerrawupdate', receive);
		};
	}, []);
	const sendKey = (event: React.KeyboardEvent, action: number) => {
		if (event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey) && !event.altKey) {
			event.preventDefault();
			if (action === 0 && !event.repeat) {pasteRequest.current = crypto.randomUUID(); vscode.postMessage({type: 'clipboard-paste', id: pasteRequest.current});}
			return;
		}
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
		onBlur: () => {pasteRequest.current = undefined;},
		onPaste: event => {
			event.preventDefault(); pasteRequest.current = undefined;
			const text = event.clipboardData.getData('text/plain');
			if (text) {send({type: 'paste', text});}
		},
		onContextMenu: event => event.preventDefault(),
	};
	return { imageRef, screenProps };
}
