export type DeviceToolAction =
	| {action: 'settings' | 'screenshot' | 'record-start' | 'record-stop'}
	| {action: 'dark-mode'; value: boolean}
	| {action: 'font-scale'; value: number};
export interface DeviceToolsState {type: 'device-tools-state'; busy: boolean; recordingStartedAt?: number; darkMode?: boolean; fontScale?: number;}
