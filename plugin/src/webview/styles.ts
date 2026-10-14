const style = document.createElement('style');
style.textContent = `
	* { box-sizing: border-box; }
	html, body, #root { height: 100%; }
	body {
		color: var(--vscode-foreground);
		background: var(--vscode-sideBar-background);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
	}
	.app {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		height: 100vh;
		min-width: 0;
	}
	.topbar {
		display: grid;
		grid-template-columns: 72px minmax(0, 1fr) 72px;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--vscode-panel-border);
		background: var(--vscode-sideBar-background);
	}
	.topbar-spacer {
		width: 72px;
		height: 32px;
	}
	.topbar-actions {
		display: flex;
		justify-content: flex-end;
		gap: 4px;
	}
	.device-pill {
		min-width: 0;
		justify-self: center;
		max-width: 100%;
		padding: 5px 12px;
		border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
		border-radius: 999px;
		color: var(--vscode-descriptionForeground);
		background: var(--vscode-editor-background);
		font-size: 12px;
		font-weight: 600;
		line-height: 18px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.device-pill.loaded {
		color: var(--vscode-foreground);
		border-color: var(--vscode-focusBorder);
	}
	select,
	button {
		min-width: 0;
		font: inherit;
		outline: none;
	}
	select {
		height: 34px;
		color: var(--vscode-dropdown-foreground);
		background: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
		border-radius: 6px;
		padding: 0 10px;
	}
	button {
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
		border: 1px solid var(--vscode-button-border, transparent);
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--vscode-button-hoverBackground);
	}
	button:disabled,
	select:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.close-button,
	.debug-button {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		color: var(--vscode-icon-foreground);
		background: transparent;
		border-color: transparent;
		border-radius: 6px;
	}
	.close-button:disabled,
	.debug-button:disabled {
		visibility: hidden;
	}
	.close-button svg,
	.debug-button svg {
		width: 18px;
		height: 18px;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		fill: none;
	}
	.close-button:hover:not(:disabled),
	.debug-button:hover:not(:disabled),
	.debug-button[aria-pressed="true"] {
		color: var(--vscode-foreground);
		background: var(--vscode-toolbar-hoverBackground);
	}
	.stage {
		min-height: 0;
		min-width: 0;
		position: relative;
		overflow: hidden;
	}
	.screen-frame {
		position: absolute;
		inset: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border-radius: 8px;
		background: transparent;
	}
	.device-rail {
		position: absolute;
		z-index: 1;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		width: 38px;
		padding: 4px;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 7px;
		background: var(--vscode-sideBar-background);
		max-height: calc(100% - 8px);
		overflow-y: auto;
	}
	.device-rail button {
		flex: none;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--vscode-icon-foreground);
	}
	.device-rail button:hover {
		background: var(--vscode-toolbar-hoverBackground);
		color: var(--vscode-foreground);
	}
	.rail-divider {
		flex: none;
		width: 20px;
		height: 1px;
		margin: 2px 0;
		background: var(--vscode-panel-border);
	}
	#screen {
		display: block;
		width: max(1px, calc(100% - 84px));
		height: 100%;
		touch-action: none;
		user-select: none;
		outline: none;
		object-fit: contain;
	}
	.drop-overlay {
		position: absolute;
		z-index: 3;
		inset: 4px;
		display: grid;
		place-items: center;
		border: 2px dashed var(--vscode-focusBorder);
		border-radius: 8px;
		background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
		pointer-events: none;
	}
	.drop-prompt {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 12px;
		color: var(--vscode-foreground);
		font-size: 14px;
		font-weight: 600;
		text-align: center;
	}
	.drop-prompt small {
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
		font-weight: 400;
	}
	.transfer-toast {
		position: absolute;
		z-index: 3;
		left: 50%;
		bottom: 10px;
		transform: translateX(-50%);
		display: grid;
		gap: 6px;
		width: min(280px, calc(100% - 16px));
		padding: 7px 10px;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 6px;
		background: var(--vscode-editor-background);
		color: var(--vscode-foreground);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
		font-size: 11px;
		pointer-events: none;
	}
	.transfer-line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.transfer-line span:nth-child(2) {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.transfer-toast.error {
		color: var(--vscode-errorForeground);
		border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
	}
	.transfer-toast.complete { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
	.transfer-progress { flex: none; margin-left: auto; }
	.transfer-bar {
		height: 3px;
		overflow: hidden;
		border-radius: 2px;
		background: var(--vscode-progressBar-background, var(--vscode-panel-border));
	}
	.transfer-bar > div {
		height: 100%;
		background: var(--vscode-button-background);
		transition: width 120ms linear;
	}
	.transfer-toast.complete .transfer-bar > div { background: var(--vscode-testing-iconPassed, var(--vscode-button-background)); }
	.transfer-time { color: var(--vscode-descriptionForeground); font-size: 10px; }
	.transfer-spinner { animation: spin 0.9s linear infinite; }
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		gap: 10px;
		place-content: center;
		justify-items: center;
		padding: 8px;
		color: var(--vscode-descriptionForeground);
		text-align: center;
	}
	.device-picker {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 36px;
		gap: 12px;
		width: min(100%, 420px);
        padding: 8px;
	}
	.device-picker select {
		height: 36px;
		padding: 0 14px;
		border-radius: 999px;
	}
	.play-button {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border-radius: 50%;
	}
	.play-button svg {
		width: 18px;
		height: 18px;
		fill: currentColor;
	}
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		gap: 12px;
		place-content: center;
		justify-items: center;
		color: var(--vscode-descriptionForeground);
		text-align: center;
	}
	.spinner {
		width: 28px;
		height: 28px;
		border: 3px solid var(--vscode-panel-border);
		border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
		border-radius: 50%;
		animation: spin 0.85s linear infinite;
	}
	.loading-status,
	.error-message,
	.status {
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	.error-message {
		color: var(--vscode-errorForeground);
	}
	.bottombar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 28px;
		padding: 6px 8px;
		border-top: 1px solid var(--vscode-panel-border);
		color: var(--vscode-descriptionForeground);
		background: var(--vscode-sideBar-background);
	}
	.status.online { color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground)); }
	.status.error { color: var(--vscode-errorForeground); }
	.audio-error { color: var(--vscode-errorForeground); }
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
`;
document.head.append(style);
