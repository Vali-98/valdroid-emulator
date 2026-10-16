import * as React from 'react';
import type { DisplayState } from '../../../shared/protocol';

export type ScreenElement = HTMLCanvasElement;
const dimensions = (image: ScreenElement) => ({ width: image.width, height: image.height });
const presentedDisplays = new WeakMap<ScreenElement, DisplayState>();
export function setPresentedDisplay(image: ScreenElement, display?: DisplayState) {
	if (display) {presentedDisplays.set(image, display);} else {presentedDisplays.delete(image);}
}

export function visibleImageRect(image: ScreenElement): { left: number; top: number; width: number; height: number } {
	const rect = image.getBoundingClientRect();
	const size = dimensions(image);
	const scale = Math.min(rect.width / size.width, rect.height / size.height);
	const width = size.width * scale;
	const height = size.height * scale;
	return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

export function mapScreenPoint(image: ScreenElement, display: DisplayState, clientX: number, clientY: number, clamp = true) {
	display = presentedDisplays.get(image) ?? display;
	const size = dimensions(image);
	if (!size.width || !size.height || !display.width || !display.height) {return null;}
	const { left, top, width, height } = visibleImageRect(image);
	if (width <= 0 || height <= 0) {return null;}
	if (!clamp && (clientX < left || clientX >= left + width || clientY < top || clientY >= top + height)) {return null;}
	const nx = Math.max(0, Math.min(1, (clientX - left) / width));
	const ny = Math.max(0, Math.min(1, (clientY - top) / height));
	let x = nx;
	let y = ny;
	switch (display.orientation & 3) {
		case 1: x = 1 - ny; y = nx; break;
		case 2: x = 1 - nx; y = 1 - ny; break;
		case 3: x = ny; y = 1 - nx; break;
	}
	return { x: Math.round(x * (display.width - 1)), y: Math.round(y * (display.height - 1)) };
}

const keyCodes: Record<string, number> = {
	Enter: 66,
	Escape: 111,
	Backspace: 67,
	Tab: 61,
	' ': 62,
	ArrowUp: 19,
	ArrowDown: 20,
	ArrowLeft: 21,
	ArrowRight: 22,
	Home: 3,
	End: 123,
	PageUp: 92,
	PageDown: 93,
	Delete: 112,
	Shift: 59,
	Control: 113,
	Alt: 57,
	Meta: 117,
};

export function androidKeyCode(key: string): number {
	if (/^[a-z]$/i.test(key)) {return key.toUpperCase().charCodeAt(0) - 65 + 29;}
	if (/^[0-9]$/.test(key)) {return key === '0' ? 7 : Number(key) + 7;}
	return keyCodes[key] || 0;
}

export function metaState(event: React.KeyboardEvent): number {
	return (event.shiftKey ? 1 : 0) | (event.altKey ? 2 : 0) | (event.ctrlKey ? 0x1000 : 0) | (event.metaKey ? 0x10000 : 0);
}
