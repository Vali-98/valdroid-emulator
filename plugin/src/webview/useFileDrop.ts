import * as React from 'react';
import { uploadFile } from './upload';

function hasFiles(types: DataTransfer['types']): boolean {
	return Array.from(types).includes('Files');
}

export function useFileDrop(serverUrl: string): {
	dragging: boolean;
	message: string;
	progress?: number;
	elapsedSeconds: number;
	complete: boolean;
	error: boolean;
	onDragEnter: React.DragEventHandler<HTMLElement>;
	onDragLeave: React.DragEventHandler<HTMLElement>;
	onDragOver: React.DragEventHandler<HTMLElement>;
	onDrop: React.DragEventHandler<HTMLElement>;
} {
	const [dragging, setDragging] = React.useState(false);
	const [message, setMessage] = React.useState('');
	const [progress, setProgress] = React.useState<number | undefined>();
	const [startedAt, setStartedAt] = React.useState<number | undefined>();
	const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
	const [complete, setComplete] = React.useState(false);
	const [error, setError] = React.useState(false);
	const uploadRef = React.useRef<AbortController | undefined>(undefined);
	const clearTimerRef = React.useRef<number | undefined>(undefined);

	React.useEffect(() => {
		const preventNavigation = (event: DragEvent) => {
			if (serverUrl && event.dataTransfer && hasFiles(event.dataTransfer.types)) {event.preventDefault();}
		};
		const clearDragState = () => setDragging(false);
		window.addEventListener('dragover', preventNavigation);
		window.addEventListener('drop', preventNavigation);
		window.addEventListener('drop', clearDragState);
		return () => {
			window.removeEventListener('dragover', preventNavigation);
			window.removeEventListener('drop', preventNavigation);
			window.removeEventListener('drop', clearDragState);
			uploadRef.current?.abort();
			window.clearTimeout(clearTimerRef.current);
		};
	}, [serverUrl]);

	React.useEffect(() => {
		if (!startedAt || complete) {return;}
		const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
		updateElapsed();
		const interval = window.setInterval(updateElapsed, 250);
		return () => window.clearInterval(interval);
	}, [startedAt, complete]);

	const onDragEnter: React.DragEventHandler<HTMLElement> = event => {
		if (!serverUrl || uploadRef.current || !hasFiles(event.dataTransfer.types)) {return;}
		event.preventDefault();
		setDragging(true);
	};
	const onDragLeave: React.DragEventHandler<HTMLElement> = event => {
		if (!hasFiles(event.dataTransfer.types)) {return;}
		const next = event.relatedTarget;
		if (next instanceof Node && event.currentTarget.contains(next)) {return;}
		const bounds = event.currentTarget.getBoundingClientRect();
		if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {return;}
		setDragging(false);
	};
	const onDragOver: React.DragEventHandler<HTMLElement> = event => {
		if (!serverUrl || !hasFiles(event.dataTransfer.types)) {return;}
		event.preventDefault();
		if (!uploadRef.current) {setDragging(true);}
		event.dataTransfer.dropEffect = uploadRef.current ? 'none' : 'copy';
	};
	const onDrop: React.DragEventHandler<HTMLElement> = event => {
		if (!serverUrl || !hasFiles(event.dataTransfer.types)) {return;}
		event.preventDefault();
		setDragging(false);
		if (uploadRef.current) {return;}
		const files = Array.from(event.dataTransfer.files);
		if (files.length === 0) {return;}
		const controller = new AbortController();
		uploadRef.current = controller;
		window.clearTimeout(clearTimerRef.current);
		setError(false);
		setComplete(false);
		const startTime = Date.now();
		setStartedAt(startTime);
		setElapsedSeconds(0);
		void (async () => {
			try {
				for (let index = 0; index < files.length; index++) {
					const file = files[index];
					setProgress(0);
					setMessage(`Sending ${file.name}${files.length > 1 ? ` (${index + 1}/${files.length})` : ''}`);
					await uploadFile(serverUrl, file, controller.signal, setProgress);
				}
				setProgress(100);
				setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
				setComplete(true);
				setMessage(files.length === 1 ? `${files[0].name} sent to Downloads` : `${files.length} files sent to Downloads`);
			} catch (failure) {
				if (controller.signal.aborted) {return;}
				setError(true);
				setComplete(false);
				setProgress(undefined);
				setMessage(failure instanceof Error ? failure.message : String(failure));
			} finally {
				if (uploadRef.current === controller) {uploadRef.current = undefined;}
				clearTimerRef.current = window.setTimeout(() => setMessage(''), 5000);
			}
		})();
	};
	return { dragging, message, progress, elapsedSeconds, complete, error, onDragEnter, onDragLeave, onDragOver, onDrop };
}
