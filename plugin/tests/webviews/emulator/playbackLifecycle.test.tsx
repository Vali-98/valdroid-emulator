import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmulatorScreen } from '../../../src/webviews/emulator/components/EmulatorScreen';
import {phoneDimensions} from '../../../src/webviews/emulator/components/PhoneFrame';

it('sizes loading and video consistently for the actual device, rotation and portrait-locked apps', () => {
	const display = {id: 0, width: 1080, height: 2400, orientation: 0};
	expect(phoneDimensions(display)).toEqual({'--phone-ratio': 1080 / 2400, '--phone-inverse-ratio': 2400 / 1080});
	expect(phoneDimensions({...display, orientation: 1})).toEqual({'--phone-ratio': 2400 / 1080, '--phone-inverse-ratio': 1080 / 2400});
	expect(phoneDimensions({...display, orientation: 1, orientationCorrection: 1})).toEqual(phoneDimensions(display));
});

const media = vi.hoisted(() => ({start: vi.fn(), stops: [] as Array<ReturnType<typeof vi.fn>>}));
vi.mock('../../../src/webviews/emulator/media/avcVideo', () => ({startAVCVideo: media.start}));
vi.mock('../../../src/webviews/shared/vscode', () => ({vscode: {postMessage: vi.fn()}}));
beforeEach(() => {
	media.stops = [];
	media.start.mockReset().mockImplementation(() => {const stop = vi.fn(); media.stops.push(stop); return stop;});
});
const props = () => ({serverUrl: 'http://localhost', display: {id: 0, width: 1080, height: 2400, orientation: 0},
	send: vi.fn(() => true), onStatus: vi.fn(), onStats: vi.fn(), status: 'Playing', attempt: 0, onRestart: vi.fn()});

it('keeps playback connected through metadata changes and recreates it only on retry', () => {
	const initial = props();
	const {rerender, unmount} = render(<EmulatorScreen {...initial} />);
	expect(media.start).toHaveBeenCalledOnce();
	rerender(<EmulatorScreen {...initial} display={{...initial.display, orientation: 1}} />);
	expect(media.start).toHaveBeenCalledOnce(); expect(media.stops[0]).not.toHaveBeenCalled();
	rerender(<EmulatorScreen {...initial} attempt={1} />);
	expect(media.start).toHaveBeenCalledTimes(2); expect(media.stops[0]).toHaveBeenCalledOnce();
	unmount(); expect(media.stops[1]).toHaveBeenCalledOnce();
});

it('releases every playback instance during Strict Mode setup/cleanup and unmount', () => {
	const {unmount} = render(<StrictMode><EmulatorScreen {...props()} /></StrictMode>);
	expect(media.start.mock.calls.length - media.stops.filter(stop => stop.mock.calls.length > 0).length).toBe(1);
	unmount();
	for (const stop of media.stops) {expect(stop).toHaveBeenCalledOnce();}
});

it('uses the shared phone frame for each loading phase without restarting playback', () => {
	const initial = props();
	const view = render(<EmulatorScreen {...initial} />);
	const canvas = view.container.querySelector('canvas');
	for (const status of ['Building…', 'Installing…', 'Launching…', 'Connecting…', 'Reconnecting device…']) {
		view.rerender(<EmulatorScreen {...initial} launchStatus={status} />);
		expect(screen.getByText(status).closest('.phone-frame')).toBeTruthy();
		expect(view.container.querySelector('.phone-loading-layer')?.parentElement).toBe(view.container);
		expect(view.container.querySelector('canvas')).toBe(canvas);
	}
	view.rerender(<EmulatorScreen {...initial} />);
	expect(view.container.querySelector('.phone-loading-layer')).toBeNull();
	expect(media.start).toHaveBeenCalledOnce(); expect(media.stops[0]).not.toHaveBeenCalled();
});
