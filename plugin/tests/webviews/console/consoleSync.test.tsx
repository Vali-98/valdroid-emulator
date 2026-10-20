import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConsoleApp } from '../../../src/webviews/console/ConsoleApp';
import type { ConsoleMessage } from '../../../src/shared/console';
import { bridge } from '../../../src/webviews/console/bridge';

vi.mock('../../../src/webviews/console/bridge', () => ({ bridge: { getState: () => undefined, setState: vi.fn(), postMessage: vi.fn() } }));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({ getTotalSize: () => 0, getVirtualItems: () => [], scrollToIndex: vi.fn() }) }));

function device(serial?: string) {
	const message: ConsoleMessage = { type: 'console-state', state: { serial, streaming: Boolean(serial), busy: false, packages: [], processes: {} } };
	act(() => { window.dispatchEvent(new MessageEvent('message', { data: message })); });
}

it('follows the emulator host state without an independent device selector', () => {
	render(<ConsoleApp />);
	expect((screen.getByRole('textbox', { name: 'ADB command' }) as HTMLInputElement).disabled).toBe(true);
	device('emulator-5554');
	expect(screen.getByTitle('emulator-5554')).toBeTruthy();
	expect((screen.getByRole('textbox', { name: 'ADB command' }) as HTMLInputElement).disabled).toBe(false);
	device('emulator-5580');
	expect(screen.getByTitle('emulator-5580')).toBeTruthy();
	expect(screen.queryByTitle('emulator-5554')).toBeNull();
	device();
	expect(screen.getByTitle('No emulator loaded')).toBeTruthy();
	expect((screen.getByRole('textbox', { name: 'ADB command' }) as HTMLInputElement).disabled).toBe(true);
});

it('persists preferences on user actions instead of log updates', () => {
	render(<ConsoleApp />);
	device('emulator-5554');
	expect(bridge.setState).not.toHaveBeenCalled();
	fireEvent.change(screen.getByRole('textbox', {name: 'Search logs'}), {target: {value: 'crash'}});
	expect(bridge.setState).toHaveBeenCalledExactlyOnceWith({level: 'V', packageName: '', search: 'crash', history: []});
	device('emulator-5580');
	expect(bridge.setState).toHaveBeenCalledOnce();
});

it('retains Metro output while switching tabs and accepts a restored host snapshot', () => {
	render(<ConsoleApp />);
	act(() => window.dispatchEvent(new MessageEvent('message', {data: {type: 'project-info', expo: true, reactNative: true}})));
	act(() => window.dispatchEvent(new MessageEvent('message', {data: {type: 'metro-snapshot', text: 'previous build\n'}})));
	act(() => window.dispatchEvent(new MessageEvent('message', {data: {type: 'metro-output', text: 'Metro ready\n'}})));
	fireEvent.click(screen.getByRole('tab', {name: 'Metro'}));
	expect(screen.getByRole('tabpanel', {name: 'Metro'}).textContent).toContain('previous build\nMetro ready');
	fireEvent.click(screen.getByRole('tab', {name: 'Logcat'}));
	fireEvent.click(screen.getByRole('tab', {name: 'Metro'}));
	expect(screen.getByRole('tabpanel', {name: 'Metro'}).textContent).toContain('previous build\nMetro ready');
});

it('shows no tab bar in generic projects, even if Metro was previously selected', () => {
	render(<ConsoleApp />);
	expect(screen.queryByRole('tablist')).toBeNull();
	act(() => window.dispatchEvent(new MessageEvent('message', {data: {type: 'project-info', expo: true, reactNative: true}})));
	fireEvent.click(screen.getByRole('tab', {name: 'Metro'}));
	act(() => window.dispatchEvent(new MessageEvent('message', {data: {type: 'project-info', expo: false, reactNative: false}})));
	expect(screen.queryByRole('tablist')).toBeNull();
	expect(screen.queryByRole('tabpanel', {name: 'Metro'})).toBeNull();
	expect(screen.getByRole('textbox', {name: 'ADB command'})).toBeTruthy();
});
