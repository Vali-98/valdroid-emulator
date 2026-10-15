import type { ConsoleRequest } from '../shared/console';

interface ConsolePreferences { level?: string; packageName?: string; search?: string; history?: string[]; }
declare function acquireVsCodeApi(): {
	postMessage(message: ConsoleRequest): void;
	getState(): ConsolePreferences | undefined;
	setState(state: ConsolePreferences): void;
};
export const bridge = acquireVsCodeApi();
