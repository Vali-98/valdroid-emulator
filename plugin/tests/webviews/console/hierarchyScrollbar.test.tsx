import {createRef} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {expect, it} from 'vitest';
import {HierarchyScrollbar} from '../../../src/webviews/console/HierarchyScrollbar';

it('shows an explicit horizontal scrollbar, drags the tree, and follows native scrolling', () => {
	const viewport = createRef<HTMLDivElement>();
	viewport.current = document.createElement('div');
	Object.defineProperty(viewport.current, 'clientWidth', {value: 200});
	render(<HierarchyScrollbar viewport={viewport} contentWidth={800} />);
	const scrollbar = screen.getByRole('slider', {name: 'Scroll hierarchy horizontally'}) as HTMLInputElement;
	expect(scrollbar.max).toBe('600');
	fireEvent.change(scrollbar, {target: {value: '300'}});
	expect(viewport.current.scrollLeft).toBe(300);
	viewport.current.scrollLeft = 120;
	fireEvent.scroll(viewport.current);
	expect(scrollbar.value).toBe('120');
});

it('omits the control when the tree fits horizontally', () => {
	const viewport = createRef<HTMLDivElement>();
	viewport.current = document.createElement('div');
	Object.defineProperty(viewport.current, 'clientWidth', {value: 800});
	render(<HierarchyScrollbar viewport={viewport} contentWidth={200} />);
	expect(screen.queryByRole('slider')).toBeNull();
});
