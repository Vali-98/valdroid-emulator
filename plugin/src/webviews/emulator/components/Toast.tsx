import * as React from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, Unplug } from 'lucide-react';
export interface ToastNotice {message: string; phase: 'sending' | 'complete' | 'error' | 'info'; startedAt: number; finishedAt?: number; progress?: number;}

export function Toast({ notice, onDismiss }: { notice: ToastNotice; onDismiss: () => void }) {
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
			{notice.phase === 'complete' ? <CheckCircle2 size={16} /> : sending ? <LoaderCircle className="transfer-spinner" size={16} /> : notice.phase === 'error' ? <AlertCircle size={16} /> : <Unplug size={16} />}
			<span>{notice.message}</span>
			{notice.progress !== undefined && <span className="transfer-progress">{notice.progress}%</span>}
		</div>
		{notice.progress !== undefined && <div className="transfer-bar" aria-label={`Transfer ${notice.progress}% complete`}><div style={{ width: `${notice.progress}%` }} /></div>}
		{notice.progress !== undefined && <div className="transfer-time">{sending ? `${elapsed}s elapsed` : `Completed in ${elapsed}s`}</div>}
	</div>;
}

