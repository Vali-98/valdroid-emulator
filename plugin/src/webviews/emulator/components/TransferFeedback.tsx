import * as React from 'react';
import { CheckCircle2, LoaderCircle, Upload } from 'lucide-react';
import type { TransferNotice } from '../hooks/useFileTransfer';

function TransferToast({ notice, onDismiss }: { notice: TransferNotice; onDismiss: () => void }) {
	const [now, setNow] = React.useState(Date.now);
	const sending = notice.phase === 'sending';
	React.useEffect(() => {
		if (sending) {
			const interval = window.setInterval(() => setNow(Date.now()), 1000);
			return () => window.clearInterval(interval);
		}
		const timer = window.setTimeout(onDismiss, notice.phase === 'error' ? 8000 : 5000);
		return () => window.clearTimeout(timer);
	}, [sending, notice.phase, notice.message, onDismiss]);
	const elapsed = Math.max(0, Math.floor(((notice.finishedAt ?? now) - notice.startedAt) / 1000));
	return <div className={`transfer-toast ${notice.phase}`} role="status">
		<div className="transfer-line">
			{notice.phase === 'complete' ? <CheckCircle2 size={16} /> : sending ? <LoaderCircle className="transfer-spinner" size={16} /> : <Upload size={16} />}
			<span>{notice.message}</span>
			{notice.progress !== undefined && <span className="transfer-progress">{notice.progress}%</span>}
		</div>
		{notice.progress !== undefined && <div className="transfer-bar" aria-label={`Transfer ${notice.progress}% complete`}><div style={{ width: `${notice.progress}%` }} /></div>}
		{notice.progress !== undefined && <div className="transfer-time">{sending ? `${elapsed}s elapsed` : `Completed in ${elapsed}s`}</div>}
	</div>;
}

export function TransferFeedback({ dragging, notice, onDismiss }: {
	dragging: boolean;
	notice?: TransferNotice;
	onDismiss: () => void;
}) {
	return <>
		<div className={`drop-overlay ${dragging ? 'visible' : ''}`} aria-hidden={!dragging}>
			<div className="drop-prompt"><Upload size={24} /><span>Drop to send to device</span><small>Install APKs or send files to Downloads</small></div>
		</div>
		{notice && <TransferToast key={notice.startedAt} notice={notice} onDismiss={onDismiss} />}
	</>;
}
