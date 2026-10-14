import * as React from 'react';
import { ArrowLeft, House, PanelsTopLeft, Play, Power, Volume1, Volume2, VolumeX, X } from 'lucide-react';

export interface EmulatorTarget {
	label: string;
	value: string;
}

export function Header({ title, loaded, onClose }: { title: string; loaded: boolean; onClose: () => void }): React.JSX.Element {
	return <header className="topbar">
		<div className="topbar-spacer" />
		<div className={`device-pill ${loaded ? 'loaded' : ''}`}>{title}</div>
		<button type="button" className="close-button" disabled={!loaded} onClick={onClose} aria-label="Close emulator" title="Close emulator"><X size={18} /></button>
	</header>;
}

export function DeviceRail({ left, onKey }: { left: number; onKey: (keyCode: number) => void }): React.JSX.Element {
	return <nav className="device-rail" style={{ left }} aria-label="Device controls">
		<button type="button" onClick={() => onKey(26)} aria-label="Power" title="Power"><Power size={18} /></button>
		<div className="rail-divider" />
		<button type="button" onClick={() => onKey(4)} aria-label="Back" title="Back"><ArrowLeft size={18} /></button>
		<button type="button" onClick={() => onKey(3)} aria-label="Home" title="Home"><House size={18} /></button>
		<button type="button" onClick={() => onKey(187)} aria-label="Recent apps" title="Recent apps"><PanelsTopLeft size={18} /></button>
		<div className="rail-divider" />
		<button type="button" onClick={() => onKey(24)} aria-label="Volume up" title="Volume up"><Volume2 size={18} /></button>
		<button type="button" onClick={() => onKey(25)} aria-label="Volume down" title="Volume down"><Volume1 size={18} /></button>
		<button type="button" onClick={() => onKey(164)} aria-label="Mute device" title="Mute device"><VolumeX size={18} /></button>
	</nav>;
}

export function DevicePicker({ targets, selected, onSelect, onRefresh, onStart, error }: {
	targets: EmulatorTarget[];
	selected: string;
	onSelect: (value: string) => void;
	onRefresh: () => void;
	onStart: () => void;
	error?: string;
}): React.JSX.Element {
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

export function LoadingState({ status }: { status: string }): React.JSX.Element {
	return <div className="loading"><div className="spinner" /><div className="loading-status">{status}</div></div>;
}

export function EmulatorScreen({ serverUrl, imageRef, onLoad, onPointerDown, onWheel, onKeyDown, onKeyUp }: {
	serverUrl: string;
	imageRef: React.RefObject<HTMLImageElement | null>;
	onLoad: () => void;
	onPointerDown: (event: React.PointerEvent<HTMLImageElement>) => void;
	onWheel: (event: React.WheelEvent<HTMLImageElement>) => void;
	onKeyDown: (event: React.KeyboardEvent<HTMLImageElement>) => void;
	onKeyUp: (event: React.KeyboardEvent<HTMLImageElement>) => void;
}): React.JSX.Element {
	return <div className="screen-frame"><img
		ref={imageRef}
		id="screen"
		src={`${serverUrl}/stream`}
		alt="Android emulator display"
		draggable={false}
		tabIndex={0}
		onLoad={onLoad}
		onPointerDown={onPointerDown}
		onContextMenu={event => event.preventDefault()}
		onWheel={onWheel}
		onKeyDown={onKeyDown}
		onKeyUp={onKeyUp}
	/></div>;
}

export function StatusBar({ status, state, displayMeta, audioDetail, audioState, loaded }: {
	status: string;
	state: 'idle' | 'online' | 'error';
	displayMeta: string;
	audioDetail: string;
	audioState: 'off' | 'on' | 'error';
	loaded: boolean;
}): React.JSX.Element {
	return <footer className="bottombar">{loaded && <div className={`status ${state}`}>
		{[status, displayMeta].filter(Boolean).join(' · ')}
		<span className={audioState === 'error' ? 'audio-error' : ''}> · {audioDetail}</span>
	</div>}</footer>;
}
