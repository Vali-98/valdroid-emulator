import { expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { applyInitialPanelSize } from '../../src/view/initialPanelSize';
import { deferred } from '../helpers';

function fixture() {
	const values = new Map<string, unknown>();
	const workspaceState = {
		get: (key: string) => values.get(key),
		update: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
	} as unknown as vscode.Memento;
	return { context: { workspaceState }, view: { visible: true, show: vi.fn() }, resize: vi.fn(async () => undefined) };
}

it('grows the focused emulator panel once and preserves subsequent sizing', async () => {
	const { context, view, resize } = fixture();
	await applyInitialPanelSize(context, view, resize);
	await applyInitialPanelSize(context, view, resize);
	expect(view.show).toHaveBeenCalledExactlyOnceWith(false);
	expect(resize).toHaveBeenCalledOnce();
});
it('does not resize hidden views or steal focus from another panel', async () => {
	const { context, view, resize } = fixture();
	view.visible = false;
	await applyInitialPanelSize(context, view, resize);
	expect(view.show).not.toHaveBeenCalled(); expect(resize).not.toHaveBeenCalled();
});
it('guards concurrent ready messages and retries a failed resize', async () => {
	const { context, view } = fixture();
	const active = deferred<void>();
	const resize = vi.fn(() => active.promise);
	const first = applyInitialPanelSize(context, view, resize);
	await applyInitialPanelSize(context, view, resize);
	expect(resize).toHaveBeenCalledOnce();
	active.reject(new Error('unavailable')); await expect(first).rejects.toThrow('unavailable');
	const retry = vi.fn(async () => undefined);
	await applyInitialPanelSize(context, view, retry); expect(retry).toHaveBeenCalledOnce();
});
