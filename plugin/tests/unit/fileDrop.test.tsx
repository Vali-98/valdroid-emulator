import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useFileDrop } from '../../src/webview/hooks/useFileDrop';
import { uploadFile } from '../../src/webview/upload';
import { queryWrapper } from '../helpers';

vi.mock('../../src/webview/upload', () => ({ uploadFile: vi.fn() }));
beforeEach(() => {vi.mocked(uploadFile).mockReset().mockResolvedValue('/download/file.txt'); vi.stubGlobal('isSecureContext', true);});

function DropTarget() {
	const drop = useFileDrop('http://localhost');
	return <div {...drop.rootProps} data-testid="drop-root"><input {...drop.inputProps} />
		<span data-testid="active">{String(drop.dragging)}</span><span data-testid="notice">{drop.notice?.message}</span>
	</div>;
}

function transfer(readable = true) {
	const file = new File(['contents'], 'file.txt', { type: 'text/plain' });
	return { types: ['Files'], files: readable ? [file] : [], items: [{ kind: 'file', type: 'text/plain',
		getAsFile: () => file,
		getAsFileSystemHandle: async () => ({ getFile: async () => {throw new DOMException('Failed to execute getFile on FileSystemFileHandle', 'SecurityError');} }),
	}] };
}

it('shows and dismisses the prompt and blocks the VS Code host drag handler', async () => {
	const hostDrag = vi.fn(); window.addEventListener('dragover', hostDrag);
	try {
		render(<DropTarget />, { wrapper: queryWrapper() }); const root = screen.getByTestId('drop-root');
		await act(async () => {fireEvent.dragEnter(root, { dataTransfer: transfer() });});
		expect(screen.getByTestId('active').textContent).toBe('true');
		fireEvent.dragOver(root, { dataTransfer: transfer() }); expect(hostDrag).not.toHaveBeenCalled();
		fireEvent.dragLeave(root, { dataTransfer: transfer() });
		expect(screen.getByTestId('active').textContent).toBe('false');
	} finally {window.removeEventListener('dragover', hostDrag);}
});
it('uploads native files despite a filesystem-handle failure', async () => {
	render(<DropTarget />, { wrapper: queryWrapper() });
	await act(async () => {fireEvent.drop(screen.getByTestId('drop-root'), { dataTransfer: transfer() });});
	await waitFor(() => expect(screen.getByTestId('notice').textContent).toBe('file.txt sent to Downloads'));
	expect(uploadFile).toHaveBeenCalledOnce(); expect(screen.getByTestId('active').textContent).toBe('false');
});
it('continues accepting drags and uploads after an unrecoverable extraction failure', async () => {
	render(<DropTarget />, { wrapper: queryWrapper() }); const root = screen.getByTestId('drop-root');
	await act(async () => {fireEvent.drop(root, { dataTransfer: transfer(false) });});
	await waitFor(() => expect(screen.getByTestId('notice').textContent).toContain('getFile'));
	await act(async () => {fireEvent.dragEnter(root, { dataTransfer: transfer() });});
	expect(screen.getByTestId('active').textContent).toBe('true');
	await act(async () => {fireEvent.drop(root, { dataTransfer: transfer() });});
	await waitFor(() => expect(screen.getByTestId('notice').textContent).toBe('file.txt sent to Downloads'));
	expect(uploadFile).toHaveBeenCalledOnce();
});
