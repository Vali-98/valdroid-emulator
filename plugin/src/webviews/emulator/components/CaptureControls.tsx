import {useEffect, useState} from 'react';
import {Camera, Circle, Square} from 'lucide-react';
import type {DeviceToolAction, DeviceToolsState} from '../../../shared/deviceTools';

export function CaptureControls({state, onAction}: {state: DeviceToolsState; onAction: (command: DeviceToolAction) => void}) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {if (!state.recordingStartedAt) {return;} setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer);}, [state.recordingStartedAt]);
	const seconds = Math.max(0, Math.floor((now - (state.recordingStartedAt ?? now)) / 1000));
	return <div className="capture-controls">
		<button type="button" className="capture-button" aria-label="Save screenshot" disabled={state.busy} onClick={() => onAction({action: 'screenshot'})}><Camera size={16} /></button>
		{state.recordingStartedAt ? <div className="recording-pill"><Circle size={9} fill="currentColor" /><span role="timer" aria-label="Recording duration">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span><button type="button" className="capture-button" aria-label="Stop recording and save video" disabled={state.busy} onClick={() => onAction({action: 'record-stop'})}><Square size={13} fill="currentColor" /></button></div> : <button type="button" className="capture-button record-button" aria-label="Record screen" data-hint="Record screen (video only, up to 3 minutes)" disabled={state.busy} onClick={() => onAction({action: 'record-start'})}><Circle size={14} fill="currentColor" /></button>}
	</div>;
}
