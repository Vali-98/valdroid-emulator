import {fireEvent, render} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {JSConsole} from '../../../src/webviews/console/JSConsole';
import {bridge} from '../../../src/webviews/console/bridge';
vi.mock('../../../src/webviews/console/bridge', () => ({bridge: {postMessage: vi.fn()}}));
it('renders project callers as source buttons and library callers as plain text', () => {
	const record = {id: 1, level: 'log' as const, time: 1, args: [{type: 'string', preview: 'message'}]};
	const view = render(<JSConsole records={[
		{...record, location: 'App.tsx:12', source: {fileName: '/project/App.tsx', lineNumber: 12, columnNumber: 1}},
		{...record, id: 2, location: 'library.js:20'},
	]} />);
	fireEvent.click(view.getByRole('button', {name: 'App.tsx:12'}));
	expect(bridge.postMessage).toHaveBeenCalledWith({type: 'js-open-source', id: 1});
	expect(view.getByText('library.js:20').tagName).toBe('SPAN');
});
