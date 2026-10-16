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
