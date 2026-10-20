import { Play } from 'lucide-react';
import * as React from 'react';
import type { EmulatorTarget } from '../../../shared/protocol';
import {Switch} from './Switch';

export function DevicePicker({ targets, selected, onSelect, onRefresh, onStart, onStartExpo, project, error, launchWithExpo: savedLaunchWithExpo, onLaunchWithExpoChange }: {
	launchWithExpo?: boolean;
	onLaunchWithExpoChange?: (enabled: boolean) => void;
	project?: {expo: boolean; reactNative: boolean};
	targets: EmulatorTarget[];
	selected: string;
	onSelect: (value: string) => void;
	onRefresh: () => void;
	onStart: () => void;
	onStartExpo?: () => void;
	error?: string;
}) {
	const [localLaunchWithExpo, setLocalLaunchWithExpo] = React.useState(false);
	const launchWithExpo = savedLaunchWithExpo ?? localLaunchWithExpo;
	const setLaunchWithExpo = (enabled: boolean) => {setLocalLaunchWithExpo(enabled); onLaunchWithExpoChange?.(enabled);};
	React.useEffect(() => {
		const timer = window.setInterval(onRefresh, 3000);
		return () => window.clearInterval(timer);
	}, [onRefresh]);
	const abi = targets.find(target => target.value === selected)?.abi;
	return <div className="empty">
		<div className="device-picker">
			<div className="device-picker-row">
			<select aria-label="Select device" value={selected} onChange={event => onSelect(event.target.value)} onFocus={onRefresh}>
				<option value="" disabled>Select Device...</option>
				{targets.length === 0 && <option value="">No devices found</option>}
				{targets.map(target => <option key={target.value} value={target.value}>
					{target.label}{target.value.startsWith('device:') ? ' (running)' : ''}
				</option>)}
			</select>
				<button type="button" className="play-button" aria-label="Start Emulator" title="Start Emulator" disabled={!selected} onClick={project?.expo && launchWithExpo && onStartExpo ? onStartExpo : onStart}><Play size={18} /></button>
			</div>
			{project?.expo && <div className="project-start-actions"><Switch label="Launch with Expo Integration" checked={launchWithExpo} onChange={setLaunchWithExpo} disabled={!onStartExpo} /></div>}
		</div>
		{(abi === 'x86' || abi === 'x86_64') && <p className="device-performance-warning">
			Performance may be poor on x86 devices. ARM devices are recommended.
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
		<div className="loading-bar" role="progressbar" aria-label="Initializing emulator" />
		<div className="loading-status">{status}</div>
		{canRetry && onRetry && <button type="button" className="loading-retry" onClick={onRetry}>Taking a while to load, retry?</button>}
	</div>;
}
