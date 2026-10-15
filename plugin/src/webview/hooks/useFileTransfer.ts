import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { uploadFile } from '../upload';
import { isApk } from '../../shared/protocol';

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
			let installed = 0;
			for (const [index, file] of files.entries()) {
				if (controller.signal.aborted) {throw new Error('Upload canceled');}
				const message = `${isApk(file.name) ? 'Installing' : 'Sending'} ${file.name}${files.length > 1 ? ` (${index + 1}/${files.length})` : ''}`;
				setProgress({ message, percent: 0 });
				const result = await uploadFile(file, controller.signal, percent => {
					if (!controller.signal.aborted) {setProgress({ message, percent });}
				});
				if (result.kind === 'installed') {installed++;}
			}
			const downloaded = files.length - installed;
			const completed = [installed ? `${installed} ${installed === 1 ? 'APK' : 'APKs'} installed` : '',
				downloaded ? `${downloaded} ${downloaded === 1 ? 'file' : 'files'} sent to Downloads` : ''].filter(Boolean).join('; ');
			return {
				message: files.length === 1 ? `${files[0].name} ${installed ? 'installed' : 'sent to Downloads'}` : completed,
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
		setProgress({ message: `${isApk(files[0].name) ? 'Installing' : 'Sending'} ${files[0].name}`, percent: 0 });
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
