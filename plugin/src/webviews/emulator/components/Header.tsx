import { Bug, X } from 'lucide-react';

export function Header({ title, loaded, debugVisible = false, onToggleDebug, onClose }: {
	title: string;
	loaded: boolean;
	debugVisible?: boolean;
	onToggleDebug?: () => void;
	onClose?: () => void;
}) {
	return <header className="topbar">
		<div className="topbar-spacer" />
		<div className={`device-pill ${loaded ? 'loaded' : ''}`}>{title}</div>
		<div className="topbar-actions">
			<button type="button" className="debug-button" disabled={!loaded} aria-pressed={debugVisible} onClick={onToggleDebug} aria-label={debugVisible ? 'Hide debug info' : 'Show debug info'} title={debugVisible ? 'Hide debug info' : 'Show debug info'}><Bug size={16} /></button>
			<button type="button" className="close-button" disabled={!loaded} onClick={onClose} aria-label="Close emulator" title="Close emulator"><X size={18} /></button>
		</div>
	</header>;
}
