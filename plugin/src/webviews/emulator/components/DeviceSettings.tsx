import {Settings2} from 'lucide-react';
import {Switch} from './Switch';
import type {DeviceToolAction, DeviceToolsState} from '../../../shared/deviceTools';

export function DeviceSettings({state, onAction}: {state: DeviceToolsState; onAction: (command: DeviceToolAction) => void}) {
	return <details className="device-settings" onToggle={event => {if (event.currentTarget.open) {onAction({action: 'settings'});}}}>
		<summary aria-label="Device settings"><Settings2 size={18} /></summary>
		<div className="device-settings-popup">
			<Switch label="Dark mode" checked={state.darkMode ?? false} disabled={state.busy || state.darkMode === undefined} onChange={value => onAction({action: 'dark-mode', value})} />
			<label>Text size<select aria-label="Text size" disabled={state.busy || state.fontScale === undefined} value={state.fontScale ?? 1} onChange={event => onAction({action: 'font-scale', value: Number(event.target.value)})}>
				{[...new Set([0.85, 1, 1.15, 1.3, 1.5, 2, ...(state.fontScale ? [state.fontScale] : [])])].sort((a, b) => a - b).map(scale => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}
			</select></label>
		</div>
	</details>;
}
