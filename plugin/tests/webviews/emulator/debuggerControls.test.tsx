import {fireEvent, render} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {Header} from '../../../src/webviews/emulator/components/Header';
import {DebuggerPaused} from '../../../src/webviews/emulator/components/DebuggerPaused';
vi.mock('../../../src/webviews/shared/vscode', () => ({vscode: {postMessage: vi.fn()}}));

it('offers a debugging preference only for Expo without a manual attach button', () => {
	const action = vi.fn();
	const devtools = {type: 'devtools' as const, active: true, enabled: false, connected: true};
	const view = render(<Header title="Phone" loaded devtools={devtools} onDebuggingChange={action} />);
	fireEvent.click(view.getByRole('switch', {name: 'Enable debugging', hidden: true})); expect(action).toHaveBeenCalledWith(false);
	expect(view.queryByLabelText('Step over')).toBeNull();
	view.rerender(<Header title="Phone" loaded devtools={{...devtools, debugger: {attached: true, busy: false, paused: true, enabled: false}}} onDebuggingChange={action} />);
	expect(view.queryByLabelText('Step over')).toBeNull();
	fireEvent.click(view.getByRole('switch', {name: 'Enable debugging', hidden: true})); expect(action).toHaveBeenCalledWith(true);
	view.rerender(<Header title="Phone" loaded devtools={{...devtools, active: false}} onDebuggingChange={action} />);
	expect(view.queryByLabelText('Attach Hermes debugger')).toBeNull();
});
it('offers resume, step over and console inside the paused screen panel', () => {
	const action = vi.fn();
	const view = render(<DebuggerPaused onAction={action} />);
	fireEvent.click(view.getByText('Resume execution')); expect(action).toHaveBeenLastCalledWith('continue');
	fireEvent.click(view.getByText('Step over')); expect(action).toHaveBeenLastCalledWith('next');
	fireEvent.click(view.getByText('Open debugger console')); expect(action).toHaveBeenLastCalledWith('console');
});
it('offers Show dev menu as an action button that closes the dropdown', () => {
	const show = vi.fn();
	const view = render(<Header title="Phone" loaded devtools={{type: 'devtools', active: true, enabled: false, connected: true}} onShowDevMenu={show} />);
	const button = view.getByRole('button', {name: 'Open Dev Menu', hidden: true});
	const menu = button.closest('details')!;
	menu.open = true;
	fireEvent.click(button);
	expect(show).toHaveBeenCalledOnce(); expect(menu.open).toBe(false);
});
