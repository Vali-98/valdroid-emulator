import { Upload } from 'lucide-react';
import { Toast, type ToastNotice } from './Toast';

export function TransferFeedback({ dragging, notice, onDismiss }: {
	dragging: boolean;
	notice?: ToastNotice;
	onDismiss: () => void;
}) {
	return <>
		<div className={`drop-overlay ${dragging ? 'visible' : ''}`} aria-hidden={!dragging}>
			<div className="drop-prompt"><Upload size={24} /><span>Drop to send to device</span><small>Install APKs or send files to Downloads</small></div>
		</div>
		{notice && <Toast key={notice.startedAt} notice={notice} onDismiss={onDismiss} />}
	</>;
}
