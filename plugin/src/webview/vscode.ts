import type { HostMessage } from '../shared/protocol';

declare function acquireVsCodeApi(): { postMessage(message: HostMessage): void };

export const vscode = acquireVsCodeApi();
