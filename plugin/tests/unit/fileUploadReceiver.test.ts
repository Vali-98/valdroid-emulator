// @vitest-environment node
import * as fs from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { FileUploadReceiver, type TransferFile } from '../../src/lib/FileUploadReceiver';

async function stage(receiver: FileUploadReceiver, id: string, name: string) {
	await receiver.handle({ type: 'upload-start', id, requestId: 'start', name, size: 3 }, vi.fn());
	await receiver.handle({ type: 'upload-chunk', id, requestId: 'chunk', offset: 0, data: Buffer.from('apk').toString('base64') }, vi.fn());
}

it('stages APK bytes with an apk extension and removes the temporary file after installation', async () => {
	let staged = '';
	const send = vi.fn<TransferFile>(async (file, name, serial) => {
		staged = file;
		expect(file.endsWith('.apk')).toBe(true);
		expect(name).toBe('App.APK'); expect(serial).toBe('emulator-5554');
		expect(await fs.readFile(file, 'utf8')).toBe('apk');
		return { kind: 'installed' };
	});
	const receiver = new FileUploadReceiver(() => 'emulator-5554', send);
	try {
		await stage(receiver, 'one', 'App.APK');
		await expect(receiver.handle({ type: 'upload-finish', id: 'one', requestId: 'finish' }, vi.fn())).resolves.toEqual({ kind: 'installed' });
		await expect(fs.stat(staged)).rejects.toMatchObject({ code: 'ENOENT' });
	} finally {await receiver.dispose();}
});

it('cleans up failed installations and accepts another drop', async () => {
	let staged = '';
	const send = vi.fn<TransferFile>(async file => {
		staged = file;
		throw new Error('INSTALL_FAILED_INVALID_APK');
	});
	const receiver = new FileUploadReceiver(() => 'emulator-5554', send);
	try {
		await stage(receiver, 'one', 'broken.apk');
		await expect(receiver.handle({ type: 'upload-finish', id: 'one', requestId: 'finish' }, vi.fn())).rejects.toThrow('INSTALL_FAILED_INVALID_APK');
		await expect(fs.stat(staged)).rejects.toMatchObject({ code: 'ENOENT' });
		vi.mocked(send).mockResolvedValueOnce({ kind: 'download', path: '/sdcard/Download/file.txt' });
		await stage(receiver, 'two', 'file.txt');
		await expect(receiver.handle({ type: 'upload-finish', id: 'two', requestId: 'finish' }, vi.fn())).resolves.toEqual({ kind: 'download', path: '/sdcard/Download/file.txt' });
	} finally {await receiver.dispose();}
});
