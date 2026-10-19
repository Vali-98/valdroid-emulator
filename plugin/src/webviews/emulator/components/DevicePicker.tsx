import { Play } from 'lucide-react';
import * as React from 'react';
import type { EmulatorTarget } from '../../../shared/protocol';

export function DevicePicker({ targets, selected, onSelect, onRefresh, onStart, error }: {
	targets: EmulatorTarget[];
	selected: string;
	onSelect: (value: string) => void;
	onRefresh: () => void;
	onStart: () => void;
	error?: string;
}) {
	React.useEffect(() => {
		const timer = window.setInterval(onRefresh, 3000);
		return () => window.clearInterval(timer);
	}, [onRefresh]);
	const action = selected.startsWith('device:') ? 'Connect to device' : 'Start emulator';
	return <div className="empty">
		<div className="device-picker">
			<select aria-label="Select device" value={selected} onChange={event => onSelect(event.target.value)} onFocus={onRefresh}>
				<option value="" disabled>Select Device...</option>
				{targets.length === 0 && <option value="">No devices found</option>}
				{targets.map(target => <option key={target.value} value={target.value}>
					{target.label}{target.value.startsWith('device:') ? ' (running)' : ''}
				</option>)}
			</select>
			<button type="button" className="play-button" disabled={!selected} onClick={onStart} aria-label={action} title={action}><Play size={18} fill="currentColor" /></button>
		</div>
		{navigator.userAgent.includes('Windows') && <p className="device-performance-warning">
			AVD performance is poor on Windows. Physical Android devices are recommended.
		</p>}
		{error && <div className="error-message">{error}</div>}
	</div>;
}

export function LoadingState({ status, startedAt, onRetry }: { status: string; startedAt?: number; onRetry?: () => void }) {
	const [canRetry, setCanRetry] = React.useState(false);
	React.useEffect(() => {
		setCanRetry(false);
		const timer = window.setTimeout(() => setCanRetry(true), Math.max(0, 90000 - (Date.now() - (startedAt ?? Date.now()))));
		return () => window.clearTimeout(timer);
	}, [startedAt]);
	return <div className="loading" role="status">
		<div className="loading-bar" role="progressbar" aria-label="Initializing emulator"><div /></div>
		<div className="loading-status">{status}</div>
		{canRetry && onRetry && <button type="button" className="loading-retry" onClick={onRetry}>Taking a while to load, retry?</button>}
	</div>;
}
