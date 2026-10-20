import { Fragment } from 'react';
import { ArrowLeft, House, PanelsTopLeft, Power, Volume1, Volume2, VolumeX, RotateCcw, RotateCw, type LucideIcon } from 'lucide-react';

const controls: Array<{ code: number; label: string; Icon: LucideIcon; divider?: boolean }> = [
	{ code: 26, label: 'Power', Icon: Power },
	{ code: 4, label: 'Back', Icon: ArrowLeft, divider: true },
	{ code: 3, label: 'Home', Icon: House },
	{ code: 187, label: 'Recent apps', Icon: PanelsTopLeft },
	{ code: 24, label: 'Volume up', Icon: Volume2, divider: true },
	{ code: 25, label: 'Volume down', Icon: Volume1 },
	{ code: 164, label: 'Mute device', Icon: VolumeX },
];

export function DeviceRail({ onKey, onRotate, busy = false }: { onKey: (keyCode: number) => void; onRotate?: (direction: 'left' | 'right') => void; busy?: boolean }) {
	return <nav className="device-rail" aria-label="Device controls">
		{controls.map(({ code, label, Icon, divider }) => <Fragment key={code}>
			{divider && <div className="rail-divider" />}
			<button type="button" onClick={() => onKey(code)} aria-label={label} title={label}><Icon size={18} /></button>
		</Fragment>)}
		<div className="rail-divider" />
		<button type="button" aria-label="Rotate left" data-hint="Rotate device left (locks orientation)" disabled={busy} onClick={() => onRotate?.('left')}><RotateCcw size={18} /></button>
		<button type="button" aria-label="Rotate right" data-hint="Rotate device right (locks orientation)" disabled={busy} onClick={() => onRotate?.('right')}><RotateCw size={18} /></button>
	</nav>;
}
