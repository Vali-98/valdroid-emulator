import {act, fireEvent, render} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {CaptureControls} from '../../../src/webviews/emulator/components/CaptureControls';
import {DeviceSettings} from '../../../src/webviews/emulator/components/DeviceSettings';
import {DeviceRail} from '../../../src/webviews/emulator/components/DeviceRail';
import {ToolbarHints} from '../../../src/webviews/emulator/components/ToolbarHints';
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
it('provides settings and both rotation controls without language controls', () => {
	const action = vi.fn(), rotate = vi.fn();
	const view = render(<><DeviceSettings state={{type: 'device-tools-state', busy: false, darkMode: false, fontScale: 1}} onAction={action} /><DeviceRail onKey={vi.fn()} onRotate={rotate} /></>);
	fireEvent.click(view.getByRole('switch', {name: 'Dark mode', hidden: true})); expect(action).toHaveBeenCalledWith({action: 'dark-mode', value: true});
	fireEvent.change(view.getByLabelText('Text size'), {target: {value: '1.3'}}); expect(action).toHaveBeenCalledWith({action: 'font-scale', value: 1.3});
	fireEvent.click(view.getByLabelText('Rotate left')); expect(rotate).toHaveBeenCalledWith('left');
	fireEvent.click(view.getByLabelText('Rotate right')); expect(rotate).toHaveBeenCalledWith('right');
	expect(view.queryByLabelText('Language')).toBeNull();
});
it('shows a custom tooltip for an icon button without clipping it inside the toolbar', () => {
	vi.useFakeTimers();
	try {
		const view = render(<><ToolbarHints /><div className="topbar"><button aria-label="Screenshot" title="Screenshot">icon</button></div></>);
		fireEvent.mouseOver(view.getByLabelText('Screenshot'));
		act(() => {vi.advanceTimersByTime(350);}); expect(view.getByRole('tooltip').textContent).toBe('Screenshot');
		fireEvent.pointerDown(view.getByLabelText('Screenshot')); expect(view.queryByRole('tooltip')).toBeNull();
		view.unmount();
	} finally {vi.useRealTimers();}
});
