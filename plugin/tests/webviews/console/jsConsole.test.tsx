import {act, fireEvent, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {ConsoleApp} from '../../../src/webviews/console/ConsoleApp';
import {bridge} from '../../../src/webviews/console/bridge';

vi.mock('../../../src/webviews/console/bridge', () => ({bridge: {getState: () => undefined, setState: vi.fn(), postMessage: vi.fn()}}));
vi.mock('@tanstack/react-virtual', () => ({useVirtualizer: () => ({getTotalSize: () => 0, getVirtualItems: () => [], scrollToIndex: vi.fn()})}));

it('shows structured JS values in their own tab and expands nested values on demand', () => {
	render(<ConsoleApp />);
	act(() => window.dispatchEvent(new MessageEvent('message', {data: {type: 'project-info', expo: true, reactNative: true}})));
	act(() => window.dispatchEvent(new MessageEvent('message', {data: {type: 'js-snapshot', records: [{id: 1, level: 'log', time: Date.now(), args: [{type: 'object', preview: 'Object', entries: [{key: 'items', value: {type: 'array', preview: 'Array(2)', entries: [{key: '0', value: {type: 'number', preview: '42'}}]}}]}]}]}})));
	fireEvent.click(screen.getByRole('tab', {name: 'JS Console'}));
	expect(screen.queryByText('items:')).toBeNull();
	const object = screen.getByText('Object').closest('details')!;
	act(() => {object.open = true; object.dispatchEvent(new Event('toggle'));});
	expect(screen.getByText('items:')).toBeTruthy();
	expect(screen.queryByText('42')).toBeNull();
	const array = screen.getByText('Array(2)').closest('details')!;
	act(() => {array.open = true; array.dispatchEvent(new Event('toggle'));});
	expect(screen.getByText('42')).toBeTruthy();
	fireEvent.click(screen.getByRole('tab', {name: 'Build'}));
	fireEvent.click(screen.getByRole('tab', {name: 'JS Console'}));
	expect(array.open).toBe(true);
	expect(object.open).toBe(true);
	act(() => window.dispatchEvent(new MessageEvent('message', {data: {type: 'js-snapshot', records: [
		{id: 2, level: 'log', time: 1, args: [], location: 'App.tsx:12', source: {fileName: '/project/App.tsx', lineNumber: 12, columnNumber: 1}},
		{id: 3, level: 'log', time: 1, args: [], location: 'library.js:20'},
	]}})));
	fireEvent.click(screen.getByRole('button', {name: 'App.tsx:12'}));
	expect(bridge.postMessage).toHaveBeenCalledWith({type: 'js-open-source', id: 2});
	expect(screen.getByText('library.js:20').closest('button')).toBeNull();
});
