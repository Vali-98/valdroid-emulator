import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DevicePicker, LoadingState } from '../../../src/webviews/emulator/components/DevicePicker';

it('refreshes connected devices automatically and stops refreshing after unmount', () => {
	vi.useFakeTimers();
	try {
		const onRefresh = vi.fn();
		const {unmount} = render(<DevicePicker targets={[]} selected="" onSelect={vi.fn()} onRefresh={onRefresh} onStart={vi.fn()} />);
		vi.advanceTimersByTime(6000);
		expect(onRefresh).toHaveBeenCalledTimes(2);
		unmount();
		vi.advanceTimersByTime(3000);
		expect(onRefresh).toHaveBeenCalledTimes(2);
	} finally {vi.useRealTimers();}
});

it('uses one start action and routes it through Expo only when its switch is enabled', () => {
	const props = {targets: [{label: 'Phone', value: 'avd:Phone'}], selected: 'avd:Phone', onSelect: vi.fn(), onRefresh: vi.fn(), onStart: vi.fn(), onStartExpo: vi.fn()};
	const {rerender} = render(<DevicePicker {...props} project={{expo: true, reactNative: true}} />);
	fireEvent.click(screen.getByRole('button', {name: 'Start Emulator'}));
	expect(props.onStart).toHaveBeenCalledOnce();
	fireEvent.click(screen.getByRole('switch', {name: 'Launch with Expo Integration'}));
	fireEvent.click(screen.getByRole('button', {name: 'Start Emulator'}));
	expect(props.onStartExpo).toHaveBeenCalledOnce();
	rerender(<DevicePicker {...props} project={{expo: false, reactNative: false}} />);
	expect(screen.queryByRole('switch')).toBeNull();
	expect(screen.getAllByRole('button')).toHaveLength(1);
	fireEvent.click(screen.getByRole('button', {name: 'Start Emulator'}));
	expect(props.onStart).toHaveBeenCalledTimes(2);
});

it('offers retry after 90 seconds without resetting when initialization status changes', () => {
	vi.useFakeTimers();
	try {
		const retry = vi.fn(); const startedAt = Date.now();
		const {rerender, unmount} = render(<LoadingState status="Starting emulator…" startedAt={startedAt} onRetry={retry} />);
		act(() => vi.advanceTimersByTime(60000));
		rerender(<LoadingState status="Connecting to agent…" startedAt={startedAt} onRetry={retry} />);
		act(() => vi.advanceTimersByTime(29999)); expect(screen.queryByRole('button')).toBeNull();
		act(() => vi.advanceTimersByTime(1));
		fireEvent.click(screen.getByRole('button', {name: 'Taking a while to load, retry?'})); expect(retry).toHaveBeenCalledOnce();
		unmount(); expect(vi.getTimerCount()).toBe(0);
	} finally {vi.useRealTimers();}
});
