import type { DisplayState, SessionState } from '../../shared/protocol';
import type { AudioStatus } from '../audio';

export function StatusBar({ status, state, display, audio }: {
	status: string;
	state: SessionState;
	display: DisplayState;
	audio: AudioStatus;
}) {
	const displayMeta = display.width > 0 && display.height > 0 ? `${display.width}x${display.height} · rotation ${display.orientation}` : '';
	return <footer className="bottombar"><div className={`status ${state}`}>
		{[status, displayMeta].filter(Boolean).join(' · ')}
		<span className={audio.state === 'error' ? 'audio-error' : ''}> · {audio.detail}</span>
	</div></footer>;
}
