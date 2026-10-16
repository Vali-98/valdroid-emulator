import { useDropzone } from 'react-dropzone';
import { filesFromEvent } from '../transfers/files';
import { useFileTransfer } from './useFileTransfer';

export function useFileDrop() {
	const transfer = useFileTransfer();
	const dropzone = useDropzone({
		disabled: transfer.pending,
		noClick: true,
		noKeyboard: true,
		// Stop VS Code's host window from taking over a handled drag.
		noDragEventsBubbling: true,
		getFilesFromEvent: filesFromEvent,
		onDropAccepted: transfer.start,
		onDrop: (accepted, rejected) => {
			if (!accepted.length && !rejected.length) {transfer.showError(new Error('No readable files were dropped'));}
		},
		onError: transfer.showError,
		onDropRejected: files => transfer.showError(new Error(files[0]?.errors[0]?.message || 'This file could not be accepted')),
	});
	return { rootProps: dropzone.getRootProps(), inputProps: dropzone.getInputProps(),
		dragging: dropzone.isDragActive && !transfer.pending, notice: transfer.notice, dismissNotice: transfer.dismiss };
}
