import type * as vscode from 'vscode';

const sizeAppliedKey = 'valdroid.emulator.initialPanelSizeApplied';
const pending = new WeakSet<vscode.Memento>();

export async function applyInitialPanelSize(
	context: Pick<vscode.ExtensionContext, 'workspaceState'>,
	view: Pick<vscode.WebviewView, 'visible' | 'show'>,
	resize: () => PromiseLike<unknown>,
): Promise<void> {
	if (!view.visible || context.workspaceState.get<boolean>(sizeAppliedKey) || pending.has(context.workspaceState)) { return; }
	pending.add(context.workspaceState);
	// VS Code's focused-view resize grows a side-docked panel by one 60px step.
	try {
		view.show(false);
		await resize();
		await context.workspaceState.update(sizeAppliedKey, true);
	} finally { pending.delete(context.workspaceState); }
}
