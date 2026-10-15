import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { isApk, maxUploadSize, uploadChunkSize, type FileTransferResult, type UploadRequest } from '../shared/protocol';

interface Upload {
	directory: string;
	file: fs.FileHandle;
	localPath: string;
	name: string;
	size: number;
	written: number;
	serial: string;
	controller: AbortController;
	finishing: boolean;
}

export type TransferFile = (file: string, name: string, serial: string, signal: AbortSignal, progress: (percent: number) => void) => Promise<FileTransferResult>;

export class FileUploadReceiver {
	private uploads = new Map<string, Upload>();
	private accepting = true;

	constructor(private readonly getSerial: () => string | undefined, private readonly transferFile: TransferFile) {}

	async handle(message: UploadRequest, progress: (percent: number) => void): Promise<FileTransferResult | undefined> {
		try {
			if (message.type === 'upload-cancel') {await this.cancel(message.id); return;}
			if (!this.accepting) {throw new Error('The emulator view is closed');}
			if (message.type === 'upload-start') {
				if (this.uploads.size) {throw new Error('Another file transfer is already in progress');}
				const serial = this.getSerial();
				if (!serial) {throw new Error('No Android device is connected');}
				if (!message.name || message.name === '.' || message.name === '..' || /[/\\\x00\r\n]/.test(message.name)) {throw new Error('Invalid filename');}
				if (!Number.isSafeInteger(message.size) || message.size < 0 || message.size > maxUploadSize) {throw new Error('File exceeds the 4 GiB upload limit');}
				const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'valdroid-upload-'));
				const localPath = path.join(directory, isApk(message.name) ? 'package.apk' : 'data');
				let file: fs.FileHandle;
				try {file = await fs.open(localPath, 'wx');}
				catch (error) {await fs.rm(directory, { recursive: true, force: true }); throw error;}
				const upload = { directory, file, localPath, name: message.name, size: message.size, written: 0, serial, controller: new AbortController(), finishing: false };
				this.uploads.set(message.id, upload);
				if (!this.accepting || this.getSerial() !== serial) {throw new Error('Device disconnected during file transfer');}
				return;
			}
			const upload = this.uploads.get(message.id);
			if (!upload) {throw new Error('File transfer is no longer active');}
			if (upload.finishing) {throw new Error('File is already being sent to the device');}
			if (this.getSerial() !== upload.serial) {throw new Error('Device changed during file transfer');}
			if (message.type === 'upload-chunk') {
				if (message.offset !== upload.written || typeof message.data !== 'string'
					|| message.data.length > Math.ceil(uploadChunkSize / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.data)) {throw new Error('Invalid file chunk');}
				const chunk = Buffer.from(message.data, 'base64');
				if (!chunk.length || chunk.length > uploadChunkSize || upload.written + chunk.length > upload.size) {throw new Error('File chunk exceeds the expected size');}
				let offset = 0;
				while (offset < chunk.length) {
					const { bytesWritten } = await upload.file.write(chunk, offset, chunk.length - offset, upload.written + offset);
					if (!bytesWritten) {throw new Error('Could not write file chunk');}
					offset += bytesWritten;
				}
				upload.written += chunk.length;
				progress(Math.round(upload.written / Math.max(1, upload.size) * 50));
				return;
			}
			if (upload.written !== upload.size) {throw new Error('File transfer is incomplete');}
			upload.finishing = true;
			await upload.file.close();
			const result = await this.transferFile(upload.localPath, upload.name, upload.serial,
				upload.controller.signal, percent => progress(50 + Math.floor(percent / 2)));
			await this.cancel(message.id);
			return result;
		} catch (error) {
			await this.cancel(message.id);
			throw error;
		}
	}

	async cancel(id: string): Promise<void> {
		const upload = this.uploads.get(id);
		if (!upload) {return;}
		this.uploads.delete(id);
		upload.controller.abort();
		await upload.file.close().catch(() => undefined);
		await fs.rm(upload.directory, { recursive: true, force: true });
	}

	async cancelAll(): Promise<void> {await Promise.all([...this.uploads.keys()].map(id => this.cancel(id)));}
	async dispose(): Promise<void> {this.accepting = false; await this.cancelAll();}
}
