import { Wrench, X, RotateCw } from 'lucide-react';
import type { DevtoolsState, LifecycleAction } from '../../../shared/protocol';
import { Switch } from './Switch';
import {InspectorButton} from './ElementInspector';

export function Header({ title, loaded, debugVisible = false, onToggleDebug, onClose, devtools, onToggleScan, inspecting = false, onToggleInspector, busy = false, onLifecycle, onDebuggingChange, onShowDevMenu }: {
	onShowDevMenu?: () => void;
	onDebuggingChange?: (enabled: boolean) => void;
	busy?: boolean;
	onLifecycle?: (action: LifecycleAction) => void;
	title: string;
	loaded: boolean;
	debugVisible?: boolean;
	onToggleDebug?: () => void;
	onClose?: () => void;
	devtools?: DevtoolsState;
	onToggleScan?: (enabled: boolean) => void;
	inspecting?: boolean;
	onToggleInspector?: () => void;
}) {
	return <header className="topbar">
		<div className="topbar-spacer" />
		<div className={`device-pill ${loaded ? 'loaded' : ''}`}>{title}</div>
		<div className="topbar-actions">
			{loaded && devtools?.active && <details className="devtools-menu lifecycle-menu"><summary aria-label="App lifecycle" title="App lifecycle"><RotateCw size={16} /></summary><div className="devtools-popup">
				{([['reload', 'Reload JS'], ['restart-app', 'Restart app'], ['restart-metro', 'Restart Metro'], ['clear-metro', 'Clear Metro cache'], ['reinstall', 'Reinstall app'], ['rebuild', 'Rebuild app'], ['clean-rebuild', 'Clean rebuild']] as [LifecycleAction, string][]).map(([action, label]) => <button type="button" key={action} disabled={busy} onClick={event => {event.currentTarget.closest('details')?.removeAttribute('open'); onLifecycle?.(action);}}>{label}</button>)}
			</div></details>}
			{loaded && devtools?.active && <InspectorButton selected={inspecting} onClick={() => onToggleInspector?.()} />}
			{loaded && <details className="devtools-menu"><summary aria-label="Devtools" title="Devtools"><Wrench size={16} aria-hidden="true" /></summary><div className="devtools-popup">
				<Switch label="Valdroid debug" checked={debugVisible} onChange={() => onToggleDebug?.()} />
				{devtools?.active && <Switch label="Enable debugging" checked={devtools.debugger?.enabled ?? true} disabled={busy || devtools.debugger?.busy} onChange={enabled => onDebuggingChange?.(enabled)} />}
				{devtools?.active && <Switch label="React Scan" checked={devtools.enabled} onChange={enabled => onToggleScan?.(enabled)} />}
				{devtools?.active && <button type="button" className="devtools-action" disabled={busy} onClick={event => {event.currentTarget.closest('details')?.removeAttribute('open'); onShowDevMenu?.();}}>Show dev menu</button>}
			</div></details>}
			<button type="button" className="close-button" disabled={!loaded} onClick={onClose} aria-label="Close emulator" title="Close emulator"><X size={18} /></button>
		</div>
	</header>;
}
