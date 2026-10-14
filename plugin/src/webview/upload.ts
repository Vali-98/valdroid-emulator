interface UploadResponse {
	path: string;
}

export function uploadFile(serverUrl: string, file: File, signal: AbortSignal, onProgress: (percent: number) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		const abort = () => request.abort();
		const finish = () => signal.removeEventListener('abort', abort);
		request.open('POST', `${serverUrl}/api/upload?name=${encodeURIComponent(file.name)}`);
		request.setRequestHeader('Content-Type', 'application/octet-stream');
		request.upload.onprogress = event => {
			if (event.lengthComputable && event.total > 0) {onProgress(Math.round(event.loaded / event.total * 100));}
		};
		request.onload = () => {
			finish();
			if (request.status !== 200) {reject(new Error(request.responseText.trim() || `Upload failed (${request.status})`)); return;}
			try {
				const response = JSON.parse(request.responseText) as UploadResponse;
				onProgress(100);
				resolve(response.path);
			} catch {reject(new Error('Invalid upload response'));}
		};
		request.onerror = () => {finish(); reject(new Error('Could not reach the device server'));};
		request.onabort = () => {finish(); reject(new Error('Upload canceled'));};
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {abort(); return;}
		request.send(file);
	});
}
