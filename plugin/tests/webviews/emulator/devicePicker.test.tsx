import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DevicePicker } from '../../../src/webviews/emulator/components/DevicePicker';

it('warns only when the selected device has an x86 ABI', () => {
	const props = {targets: [
		{label: 'Intel', value: 'avd:Intel', abi: 'x86'},
		{label: 'Intel64', value: 'avd:Intel64', abi: 'x86_64'},
		{label: 'ARM', value: 'device:arm', abi: 'arm64-v8a'},
		{label: 'Unknown', value: 'avd:Unknown'},
	], onSelect: vi.fn(), onRefresh: vi.fn(), onStart: vi.fn()};
	const {rerender} = render(<DevicePicker {...props} selected="avd:Intel" />);
	expect(screen.getByText(/Performance may be poor/)).toBeTruthy();
	rerender(<DevicePicker {...props} selected="avd:Intel64" />);
	expect(screen.getByText(/Performance may be poor/)).toBeTruthy();
	for (const selected of ['device:arm', 'avd:Unknown', '']) {
		rerender(<DevicePicker {...props} selected={selected} />);
		expect(screen.queryByText(/Performance may be poor/)).toBeNull();
	}
});

it('marks running devices in a flat list and describes the selected action', () => {
	const props = {targets: [{label: 'Phone (emulator-5554)', value: 'device:emulator-5554'}, {label: 'Other phone', value: 'avd:Other'}],
		selected: 'device:emulator-5554', onSelect: vi.fn(), onRefresh: vi.fn(), onStart: vi.fn()};
	const {rerender} = render(<DevicePicker {...props} />);
	expect(screen.getByRole('option', {name: 'Phone (emulator-5554) (running)'})).toBeTruthy();
	expect(screen.getByRole('option', {name: 'Other phone'})).toBeTruthy();
	expect(screen.queryByRole('group')).toBeNull();
	fireEvent.click(screen.getByRole('button', {name: 'Connect to device'}));
	expect(props.onStart).toHaveBeenCalledOnce();
	rerender(<DevicePicker {...props} selected="avd:Other" />);
	expect(screen.getByRole('button', {name: 'Start emulator'})).toBeTruthy();
});

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
