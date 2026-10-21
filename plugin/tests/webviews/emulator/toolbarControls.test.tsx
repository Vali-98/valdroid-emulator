import {act, fireEvent, render} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {ToolbarMenus} from '../../../src/webviews/emulator/components/ToolbarMenus';
import {ToolbarHints} from '../../../src/webviews/emulator/components/ToolbarHints';
import {CaptureControls} from '../../../src/webviews/emulator/components/CaptureControls';
import {DebuggerPaused} from '../../../src/webviews/emulator/components/DebuggerPaused';

it('keeps inside clicks open, closes outside clicks, and dismisses with Escape', () => {
	const view = render(<><ToolbarMenus /><details className="devtools-menu"><summary>Tools</summary><button>Inside</button></details><button>Outside</button></>);
	const menu = view.container.querySelector('details')!;
	act(() => {menu.open = true; menu.dispatchEvent(new Event('toggle'));});
	fireEvent.pointerDown(view.getByText('Inside')); expect(menu.open).toBe(true);
	fireEvent.pointerDown(view.getByText('Outside')); expect(menu.open).toBe(false);
	act(() => {menu.open = true; menu.dispatchEvent(new Event('toggle'));});
	fireEvent.keyDown(document, {key: 'Escape'}); expect(menu.open).toBe(false); expect(document.activeElement).toBe(view.getByText('Tools'));
});
it('allows only one tool menu at a time and suppresses pending and subsequent hints', () => {
	vi.useFakeTimers();
	try {
		const view = render(<><ToolbarMenus /><ToolbarHints /><div className="topbar"><details className="devtools-menu"><summary aria-label="Tools">Tools</summary></details></div><details className="device-settings"><summary aria-label="Settings">Settings</summary></details></>);
		const [tools, settings] = Array.from(view.container.querySelectorAll('details'));
		fireEvent.mouseOver(view.getByLabelText('Settings'));
		act(() => {settings.open = true; settings.dispatchEvent(new Event('toggle')); vi.advanceTimersByTime(400);});
		expect(view.queryByRole('tooltip')).toBeNull();
		fireEvent.mouseOver(view.getByLabelText('Tools')); act(() => {vi.advanceTimersByTime(400);});
		expect(view.queryByRole('tooltip')).toBeNull();
		act(() => {tools.open = true; tools.dispatchEvent(new Event('toggle'));});
		expect(settings.open).toBe(false); expect(tools.open).toBe(true);
		view.unmount();
	} finally {vi.useRealTimers();}
});

it('expands recording into a timer pill and dispatches Stop', () => {
	vi.useFakeTimers(); vi.setSystemTime(10000);
	try {
		const action = vi.fn(); const view = render(<CaptureControls state={{type: 'device-tools-state', busy: false}} onAction={action} />);
		fireEvent.click(view.getByLabelText('Record screen')); expect(action).toHaveBeenCalledWith({action: 'record-start'});
		view.rerender(<CaptureControls state={{type: 'device-tools-state', busy: false, recordingStartedAt: 10000}} onAction={action} />);
		act(() => {vi.advanceTimersByTime(4000);}); expect(view.getByRole('timer').textContent).toBe('0:04');
		fireEvent.click(view.getByLabelText('Stop recording and save video')); expect(action).toHaveBeenCalledWith({action: 'record-stop'});
		view.unmount();
	} finally {vi.useRealTimers();}
});

it('offers resume, step over and console inside the paused screen panel', () => {
	const action = vi.fn();
	const view = render(<DebuggerPaused onAction={action} />);
	fireEvent.click(view.getByText('Resume execution')); expect(action).toHaveBeenLastCalledWith('continue');
	fireEvent.click(view.getByText('Step over')); expect(action).toHaveBeenLastCalledWith('next');
	fireEvent.click(view.getByText('Open debugger console')); expect(action).toHaveBeenLastCalledWith('console');
});
