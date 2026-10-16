import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LoadingState } from '../../../src/webviews/emulator/components/DevicePicker';

it('offers retry after 90 seconds without resetting when initialization status changes', () => {
	vi.useFakeTimers(); const retry = vi.fn(); const startedAt = Date.now();
	const {rerender, unmount} = render(<LoadingState status="Starting emulator…" startedAt={startedAt} onRetry={retry} />);
	expect(screen.getByRole('progressbar', {name: 'Initializing emulator'})).toBeTruthy();
	act(() => vi.advanceTimersByTime(60000));
	rerender(<LoadingState status="Connecting to agent…" startedAt={startedAt} onRetry={retry} />);
	act(() => vi.advanceTimersByTime(29999)); expect(screen.queryByRole('button')).toBeNull();
	act(() => vi.advanceTimersByTime(1));
	fireEvent.click(screen.getByRole('button', {name: 'Taking a while to load, retry?'})); expect(retry).toHaveBeenCalledOnce();
	unmount(); expect(vi.getTimerCount()).toBe(0);
});
