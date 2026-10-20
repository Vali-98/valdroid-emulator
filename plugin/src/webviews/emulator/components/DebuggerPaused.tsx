import {Play, StepForward, Terminal} from 'lucide-react';
import type {DebuggerAction} from '../../../shared/protocol';

export function DebuggerPaused({onAction}: {onAction: (action: DebuggerAction) => void}) {
	return <div className="debugger-paused" onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onContextMenu={event => {event.preventDefault(); event.stopPropagation();}}>
		<section className="debugger-paused-panel" aria-label="Debugger paused">
			<div role="status">Paused in debugger</div>
			<button type="button" onClick={() => onAction('continue')} title="Continue until execution finishes, throws, or reaches another breakpoint"><Play size={16} />Resume execution</button>
			<button type="button" onClick={() => onAction('next')} title="Execute the current line and pause on the next line"><StepForward size={16} />Step over</button>
			<button type="button" onClick={() => onAction('console')}><Terminal size={16} />Open debugger console</button>
		</section>
	</div>;
}
