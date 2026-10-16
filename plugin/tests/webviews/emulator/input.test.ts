import { describe, expect, it } from 'vitest';
import type * as React from 'react';
import { androidKeyCode, mapScreenPoint, metaState, setPresentedDisplay, visibleImageRect } from '../../../src/webviews/emulator/input/input';

function image() {
	const element = document.createElement('canvas');
	Object.defineProperties(element, { width: { value: 200 }, height: { value: 400 } });
	element.getBoundingClientRect = () => new DOMRect(10, 20, 300, 400);
	return element;
}
const display = { id: 0, width: 1080, height: 2400, orientation: 0 };

describe('screen mapping', () => {
	it('uses the presented frame dimensions until new polling catches up', () => {
		const element = image();
		setPresentedDisplay(element, { ...display, width: 200, height: 400 });
		expect(mapScreenPoint(element, display, 160, 220)).toEqual({ x:100, y:200 });
		setPresentedDisplay(element);
		expect(mapScreenPoint(element, display, 160, 220)).toEqual({ x:540, y:1200 });
	});
	it('accounts for horizontal letterboxing', () => {
		expect(visibleImageRect(image())).toEqual({ left: 60, top: 20, width: 200, height: 400 });
	});
	it('maps the visible center to the device center', () => {
		expect(mapScreenPoint(image(), display, 160, 220)).toEqual({ x: 540, y: 1200 });
	});
	it('rejects presses in letterboxing', () => {
		expect(mapScreenPoint(image(), display, 30, 100, false)).toBeNull();
	});
	it('clamps captured motion outside the screen', () => {
		expect(mapScreenPoint(image(), display, -100, 1000)).toEqual({ x: 0, y: 2399 });
	});
	it.each([[0, 0, 0], [1, 1079, 0], [2, 1079, 2399], [3, 0, 2399]])('maps rotation %s', (orientation, x, y) => {
		expect(mapScreenPoint(image(), { ...display, orientation }, 60, 20)).toEqual({ x, y });
	});
	it('ignores an unloaded image or unknown device dimensions', () => {
		expect(mapScreenPoint(document.createElement('canvas'), display, 10, 10)).toBeNull();
		expect(mapScreenPoint(image(), { ...display, width: 0 }, 10, 10)).toBeNull();
	});
	it('does not divide by zero in a hidden view', () => {
		const element = image(); element.getBoundingClientRect = () => new DOMRect();
		expect(mapScreenPoint(element, display, 0, 0)).toBeNull();
	});
});

describe('keyboard mapping', () => {
	it.each([['a', 29], ['Z', 54], ['0', 7], ['9', 16], ['Enter', 66], ['ArrowUp', 19], ['Unidentified', 0]])('maps %s', (key, code) => {
		expect(androidKeyCode(key)).toBe(code);
	});
	it('combines Android modifier bits', () => {
		expect(metaState({ shiftKey: true, ctrlKey: true, altKey: true, metaKey: true } as React.KeyboardEvent)).toBe(69635);
	});
});
