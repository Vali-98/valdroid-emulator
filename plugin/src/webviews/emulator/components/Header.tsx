import { Wrench, X } from 'lucide-react';
import type { DevtoolsState } from '../../../shared/protocol';
import { Switch } from './Switch';
import {InspectorButton} from './ElementInspector';

export function Header({ title, loaded, debugVisible = false, onToggleDebug, onClose, devtools, onToggleScan, inspecting = false, onToggleInspector }: {
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
			{loaded && devtools?.active && <InspectorButton selected={inspecting} onClick={() => onToggleInspector?.()} />}
			{loaded && <details className="devtools-menu"><summary aria-label="Devtools" title="Devtools"><Wrench size={16} aria-hidden="true" /></summary><div className="devtools-popup">
				<Switch label="Valdroid debug" checked={debugVisible} onChange={() => onToggleDebug?.()} />
				{devtools?.active && <Switch label="React Scan" checked={devtools.enabled} onChange={enabled => onToggleScan?.(enabled)} />}
			</div></details>}
			<button type="button" className="close-button" disabled={!loaded} onClick={onClose} aria-label="Close emulator" title="Close emulator"><X size={18} /></button>
		</div>
	</header>;
}
