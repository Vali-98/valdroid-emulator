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
		grid-template-columns: 32px minmax(0, 1fr) 32px;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--vscode-panel-border);
		background: var(--vscode-sideBar-background);
	}
	.topbar-spacer {
		width: 32px;
		height: 32px;
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
	.close-button {
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
	.close-button:disabled {
		visibility: hidden;
	}
	.close-button svg {
		width: 18px;
		height: 18px;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		fill: none;
	}
	.close-button:hover:not(:disabled) {
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
		inset: 10px 10px 10px 58px;
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
		max-height: calc(100% - 20px);
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
		width: 100%;
		height: 100%;
		touch-action: none;
		user-select: none;
		outline: none;
		object-fit: contain;
	}
	#screen:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		gap: 10px;
		place-content: center;
		justify-items: center;
		padding: 16px;
		color: var(--vscode-descriptionForeground);
		text-align: center;
	}
	.device-picker {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 38px;
		gap: 8px;
		width: min(100%, 360px);
		padding: 8px;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 8px;
		background: var(--vscode-sideBar-background);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
	}
	.play-button {
		display: grid;
		place-items: center;
		width: 38px;
		height: 34px;
		padding: 0;
		border-radius: 6px;
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
