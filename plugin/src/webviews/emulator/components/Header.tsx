import { Bug, Wrench, X } from 'lucide-react';
import type { DevtoolsState } from '../../../shared/protocol';
import { Switch } from './Switch';

export function Header({ title, loaded, debugVisible = false, onToggleDebug, onClose, devtools, onToggleScan }: {
	title: string;
	loaded: boolean;
	debugVisible?: boolean;
	onToggleDebug?: () => void;
	onClose?: () => void;
	devtools?: DevtoolsState;
	onToggleScan?: (enabled: boolean) => void;
}) {
	return <header className="topbar">
		<div className="topbar-spacer" />
		<div className={`device-pill ${loaded ? 'loaded' : ''}`}>{title}</div>
		<div className="topbar-actions">
			{devtools?.active && <details className="devtools-menu"><summary aria-label="Devtools" title="Devtools"><Wrench size={16} aria-hidden="true" /></summary><div className="devtools-popup">
				<Switch label="React Scan" checked={devtools.enabled} onChange={enabled => onToggleScan?.(enabled)} />
			</div></details>}
			<button type="button" className="debug-button" disabled={!loaded} aria-pressed={debugVisible} onClick={onToggleDebug} aria-label={debugVisible ? 'Hide debug info' : 'Show debug info'} title={debugVisible ? 'Hide debug info' : 'Show debug info'}><Bug size={16} /></button>
			<button type="button" className="close-button" disabled={!loaded} onClick={onClose} aria-label="Close emulator" title="Close emulator"><X size={18} /></button>
		</div>
	</header>;
}
