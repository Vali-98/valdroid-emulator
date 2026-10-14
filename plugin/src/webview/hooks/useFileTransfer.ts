import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { uploadFile } from '../upload';

interface TransferRequest {
	files: File[];
	controller: AbortController;
	startedAt: number;
}

export interface TransferNotice {
	message: string;
	phase: 'sending' | 'complete' | 'error';
	progress?: number;
	startedAt: number;
	finishedAt?: number;
}

export function useFileTransfer() {
	const activeRef = React.useRef<AbortController | undefined>(undefined);
	const [progress, setProgress] = React.useState({ message: '', percent: 0 });
	const [dropError, setDropError] = React.useState('');
	const mutation = useMutation({
		mutationFn: async ({ files, controller }: TransferRequest) => {
			for (const [index, file] of files.entries()) {
				if (controller.signal.aborted) {throw new Error('Upload canceled');}
				const message = `Sending ${file.name}${files.length > 1 ? ` (${index + 1}/${files.length})` : ''}`;
				setProgress({ message, percent: 0 });
				await uploadFile(file, controller.signal, percent => {
					if (!controller.signal.aborted) {setProgress({ message, percent });}
				});
			}
			return {
				message: files.length === 1 ? `${files[0].name} sent to Downloads` : `${files.length} files sent to Downloads`,
				finishedAt: Date.now(),
			};
		},
		onSettled: (_data, _error, request) => {
			if (activeRef.current === request.controller) {activeRef.current = undefined;}
		},
	});
	React.useEffect(() => () => {activeRef.current?.abort();}, []);
	const reset = mutation.reset;
	const dismiss = React.useCallback(() => {reset(); setDropError('');}, [reset]);
	const start = (files: File[]) => {
		if (!files.length || activeRef.current) {return;}
		const controller = new AbortController();
		activeRef.current = controller;
		setDropError('');
		setProgress({ message: `Sending ${files[0].name}`, percent: 0 });
		mutation.mutate({ files, controller, startedAt: Date.now() });
	};
	let notice: TransferNotice | undefined;
	if (dropError || mutation.isError) {
		notice = { message: dropError || mutation.error?.message || 'Upload failed', phase: 'error', startedAt: 0 };
	} else if (mutation.isPending) {
		notice = { message: progress.message, phase: 'sending', progress: progress.percent, startedAt: mutation.variables.startedAt };
	} else if (mutation.isSuccess) {
		notice = { ...mutation.data, phase: 'complete', progress: 100, startedAt: mutation.variables.startedAt };
	}
	return { notice, start, dismiss, showError: (error: Error) => setDropError(error.message), pending: mutation.isPending };
}
