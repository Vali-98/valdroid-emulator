import {act, render} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {HierarchyHighlight} from '../../../src/webviews/emulator/components/HierarchyHighlight';

it('fits hierarchy highlights to letterboxed video and clears them without touching playback', () => {
	vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
	const r = render(<HierarchyHighlight />);
	act(() => {window.dispatchEvent(new MessageEvent('message', {data: {type: 'hierarchy-highlight', width: 400, height: 800, frame: {x: 10, y: 20, width: 100, height: 50}}}));});
	const frame = r.container.querySelector<HTMLElement>('.inspector-highlight')!;
	expect(frame.style.left).toBe('105px');
	expect(frame.style.top).toBe('10px');
	expect(frame.style.width).toBe('50px');
	act(() => {window.dispatchEvent(new MessageEvent('message', {data: {type: 'hierarchy-highlight', width: 1, height: 1}}));});
	expect(r.container.querySelector('.inspector-highlight')).toBeNull();
});
