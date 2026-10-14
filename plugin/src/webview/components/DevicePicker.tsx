import { Play } from 'lucide-react';
import type { EmulatorTarget } from '../../shared/protocol';

export function DevicePicker({ targets, selected, onSelect, onRefresh, onStart, error }: {
	targets: EmulatorTarget[];
	selected: string;
	onSelect: (value: string) => void;
	onRefresh: () => void;
	onStart: () => void;
	error?: string;
}) {
	return <div className="empty">
		<div className="device-picker">
			<select aria-label="Select device" value={selected} onChange={event => onSelect(event.target.value)} onFocus={onRefresh}>
				<option value="" disabled>Select Device...</option>
				{targets.length === 0 && <option value="">No devices found</option>}
				{targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}
			</select>
			<button type="button" className="play-button" disabled={!selected} onClick={onStart} aria-label="Start emulator" title="Start emulator"><Play size={18} fill="currentColor" /></button>
		</div>
		{error && <div className="error-message">{error}</div>}
	</div>;
}

export function LoadingState({ status }: { status: string }) {
	return <div className="loading"><div className="spinner" /><div className="loading-status">{status}</div></div>;
}
