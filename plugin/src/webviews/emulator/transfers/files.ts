import { fromEvent } from 'file-selector';
import type { DropEvent } from 'react-dropzone';

export async function filesFromEvent(event: DropEvent): Promise<Array<File | DataTransferItem>> {
	// Keep Dropzone's normal hover/directory handling. Only recover a failed drop.
	const fallback = 'dataTransfer' in event && event.type === 'drop'
		? Array.from(event.dataTransfer?.files ?? []) : [];
	try {
		return await fromEvent(event);
	} catch (error) {
		if (fallback.length) {return fallback;}
		throw error;
	}
}
