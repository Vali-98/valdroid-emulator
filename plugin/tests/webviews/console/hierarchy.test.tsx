import {act, fireEvent, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {Hierarchy} from '../../../src/webviews/console/Hierarchy';
import {bridge} from '../../../src/webviews/console/bridge';
import type {HierarchySnapshot} from '../../../src/shared/hierarchy';

const scrollToIndex = vi.fn();
vi.mock('../../../src/webviews/console/bridge', () => ({bridge: {postMessage: vi.fn(), getState: () => undefined, setState: vi.fn()}}));
vi.mock('@tanstack/react-virtual', () => ({useVirtualizer: ({count}: {count: number}) => ({getTotalSize: () => count * 28, getVirtualItems: () => Array.from({length: count}, (_, index) => ({index, start: index * 28, size: 28})), scrollToIndex})}));
const snapshot: HierarchySnapshot = {type: 'hierarchy-snapshot', nodes: [{id: 'root', name: 'Screen'}, {id: 'card', parentId: 'root', name: 'Card'}], selectedId: 'card', props: {type: 'object', preview: 'Object', entries: [{key: 'title', value: {type: 'string', preview: 'Hello'}}]}};
const receive = () => act(() => {window.dispatchEvent(new MessageEvent('message', {data: snapshot}));});

it('subscribes only while mounted, selects props on the left, and forwards hover/clear', () => {
	const r = render(<Hierarchy />);
	expect(bridge.postMessage).toHaveBeenCalledWith({type: 'hierarchy-active', active: true});
	receive();
	expect(screen.getAllByRole('treeitem')).toHaveLength(1);
	fireEvent.click(screen.getByLabelText('Expand Screen'));
	const row = screen.getAllByRole('treeitem')[1];
	fireEvent.mouseEnter(row);
	expect(bridge.postMessage).toHaveBeenCalledWith({type: 'hierarchy-hover', id: 'card'});
	fireEvent.click(row);
	expect(bridge.postMessage).toHaveBeenCalledWith({type: 'hierarchy-select', id: 'card'});
	expect(screen.getByLabelText('Component props').textContent).toContain('Hello');
	fireEvent.mouseLeave(screen.getByRole('tree'));
	expect(bridge.postMessage).toHaveBeenCalledWith({type: 'hierarchy-hover'});
	r.unmount();
	expect(bridge.postMessage).toHaveBeenLastCalledWith({type: 'hierarchy-active', active: false});
});

it('reveals a focused node and retains ancestor context when filtering', () => {
	render(<Hierarchy focusId="card" />);
	receive();
	expect(scrollToIndex).toHaveBeenCalledWith(1, {align: 'center'});
	fireEvent.change(screen.getByLabelText('Search components'), {target: {value: 'Card'}});
	expect(screen.getAllByRole('treeitem')).toHaveLength(2);
	fireEvent.change(screen.getByLabelText('Search components'), {target: {value: ''}});
	fireEvent.click(screen.getByLabelText('Collapse Screen'));
	expect(screen.getAllByRole('treeitem')).toHaveLength(1);
});

it('keeps deep indentation and sends debounced runtime search requests', () => {
	vi.useFakeTimers();
	render(<Hierarchy />);
	const nodes = Array.from({length: 40}, (_, index) => ({id: `node-${index}`, ...(index ? {parentId: `node-${index - 1}`} : {}), name: index === 39 ? 'DeepMatch' : 'Wrapper'}));
	act(() => {window.dispatchEvent(new MessageEvent('message', {data: {type: 'hierarchy-snapshot', nodes}}));});
	fireEvent.click(screen.getByLabelText('Expand all components'));
	expect((screen.getAllByRole('treeitem')[39] as HTMLElement).style.paddingLeft).toBe('312px');
	fireEvent.change(screen.getByLabelText('Search components'), {target: {value: 'DeepMatch'}});
	act(() => {vi.advanceTimersByTime(201);});
	expect(bridge.postMessage).toHaveBeenCalledWith({type: 'hierarchy-search', query: 'DeepMatch'});
	expect(screen.getAllByRole('treeitem')).toHaveLength(40);
});

it('reveals deep component labels horizontally when jumping to the hierarchy', () => {
	render(<Hierarchy focusId="node-39" />);
	const nodes = Array.from({length: 40}, (_, index) => ({id: `node-${index}`, ...(index ? {parentId: `node-${index - 1}`} : {}), name: 'Wrapper'}));
	act(() => {window.dispatchEvent(new MessageEvent('message', {data: {type: 'hierarchy-snapshot', nodes}}));});
	expect(screen.getByRole('tree').scrollLeft).toBe(288);
	expect(scrollToIndex).toHaveBeenCalledWith(39, {align: 'center'});
});

it('draws branch separators only when the visible list returns to a shallower depth', () => {
	render(<Hierarchy />);
	const nodes = [{id: 'a', name: '1'}, {id: 'b', parentId: 'a', name: '2'}, {id: 'c', parentId: 'b', name: '3'}, {id: 'd', name: '1'}, {id: 'e', name: '1'}, {id: 'f', parentId: 'e', name: '2'}, {id: 'g', name: '1'}];
	act(() => {window.dispatchEvent(new MessageEvent('message', {data: {type: 'hierarchy-snapshot', nodes}}));});
	fireEvent.click(screen.getByLabelText('Expand all components'));
	const rows = screen.getAllByRole('treeitem');
	expect(rows.map(row => row.classList.contains('hierarchy-branch-start'))).toEqual([false, false, false, true, false, false, true]);
});

it('defaults to collapsed branches and provides explicit expand/collapse all controls', () => {
	render(<Hierarchy />);
	receive();
	expect(screen.getAllByRole('treeitem')).toHaveLength(1);
	expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBe('false');
	fireEvent.click(screen.getByLabelText('Expand all components'));
	expect(screen.getAllByRole('treeitem')).toHaveLength(2);
	fireEvent.click(screen.getByLabelText('Collapse all components'));
	expect(screen.getAllByRole('treeitem')).toHaveLength(1);
	fireEvent.change(screen.getByLabelText('Search components'), {target: {value: 'Card'}});
	expect(screen.getAllByRole('treeitem')).toHaveLength(1);
});

it('focuses a subtree on double-click, supports returning, and only reveals the inspector target path', () => {
	const r = render(<Hierarchy />);
	const nodes = [...snapshot.nodes, {id: 'leaf', parentId: 'card', name: 'Leaf'}, {id: 'other', name: 'Other'}, {id: 'other-leaf', parentId: 'other', name: 'OtherLeaf'}];
	act(() => {window.dispatchEvent(new MessageEvent('message', {data: {type: 'hierarchy-snapshot', nodes}}));});
	fireEvent.click(screen.getByLabelText('Expand Screen'));
	fireEvent.doubleClick(screen.getByText('Card'));
	expect(screen.getAllByRole('treeitem')).toHaveLength(1);
	expect(screen.getByRole('treeitem').getAttribute('aria-level')).toBe('1');
	expect(screen.getByRole('treeitem').textContent).toBe('Card');
	fireEvent.click(screen.getByLabelText('Show full hierarchy'));
	expect(screen.getAllByRole('treeitem')).toHaveLength(3);
	fireEvent.click(screen.getByLabelText('Collapse all components'));
	r.rerender(<Hierarchy focusId="leaf" focusVersion={1} />);
	expect(screen.getAllByRole('treeitem').map(row => row.textContent)).toEqual(['Screen', 'Card', 'Leaf', 'Other']);
	expect(screen.queryByText('OtherLeaf')).toBeNull();
});

it('resizes and saves the props pane with dragging and keyboard controls', () => {
	const r = render(<Hierarchy />);
	const divider = screen.getByRole('separator', {name: 'Resize props pane'});
	const content = r.container.querySelector<HTMLElement>('.hierarchy-content')!;
	content.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 400);
	const pointer = (type: string, fields: object) => {const event = new Event(type, {bubbles: true}); Object.assign(event, {pointerId: 1, button: 0, ...fields}); fireEvent(divider, event);};
	pointer('pointerdown', {clientX: 350});
	pointer('pointermove', {clientX: 500});
	pointer('pointerup', {clientX: 500});
	expect(divider.getAttribute('aria-valuenow')).toBe('50');
	expect(bridge.setState).toHaveBeenLastCalledWith({hierarchyPropsWidth: 50});
	fireEvent.keyDown(divider, {key: 'ArrowLeft'});
	expect(divider.getAttribute('aria-valuenow')).toBe('48');
});
