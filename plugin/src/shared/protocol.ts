export interface EmulatorTarget {
	label: string;
	value: string;
	avdName?: string;
	abi?: string;
}

export type SessionState = 'idle' | 'online' | 'error';
export interface ProjectInfo {type: 'project-info'; expo: boolean; reactNative: boolean;}
export interface LaunchProgress {type: 'launch-progress'; busy: boolean; status: string; error?: import('./metro').MetroFailure;}
export const lifecycleActions = ['reload', 'restart-app', 'restart-metro', 'clear-metro', 'reinstall', 'rebuild', 'clean-rebuild'] as const;
export type LifecycleAction = typeof lifecycleActions[number] | 'reconnect-device';
export type DebuggerAction = 'attach' | 'detach' | 'pause' | 'continue' | 'next' | 'stepIn' | 'stepOut' | 'console';
export interface DebuggerState {attached: boolean; paused: boolean; busy: boolean; enabled?: boolean;}

export type HostMessage =
	| {type: 'clipboard-paste'; id: string}
	| {type: 'metro-error-source'}
	| ({type: 'device-tools'} & import('./deviceTools').DeviceToolAction)
	| {type: 'dev-menu'}
	| {type: 'debugger-preference'; enabled: boolean}
	| {type: 'debugger'; action: DebuggerAction}
	| {type: 'lifecycle'; action: LifecycleAction}
	| {type: 'inspect-show-hierarchy'; id: number; index: number}
	| {type: 'inspect-point'; id: number; x: number; y: number; select?: boolean}
	| {type: 'inspect-open-source'; id: number; index: number}
	| {type: 'expo-preference'; enabled: boolean}
	| {type: 'start-expo'; value: string}
	| {type: 'scan-toggle'; enabled: boolean}
	| {type: 'devtools-refresh'}
	| { type: 'ready' | 'refresh' | 'stop' | 'close' | 'retry' }
	| { type: 'client-error'; serverUrl: string; message: string; fatal: boolean }
	| { type: 'start'; value: string }
	| UploadRequest;

export type UploadCommand =
	| { type: 'upload-start'; id: string; name: string; size: number }
	| { type: 'upload-chunk'; id: string; offset: number; data: string }
	| { type: 'upload-finish'; id: string }
	| { type: 'upload-cancel'; id: string };

export type UploadRequest = UploadCommand & { requestId: string };
export type FileTransferResult = { kind: 'download'; path: string } | { kind: 'installed' };
export type UploadReply = { type: 'upload-result'; id: string; requestId: string; result?: FileTransferResult; error?: string };
export type UploadProgress = { type: 'upload-progress'; id: string; percent: number };
export const uploadChunkSize = 256 * 1024;
export const maxUploadSize = 4 * 1024 * 1024 * 1024;

export function isApk(name: string): boolean {return name.toLowerCase().endsWith('.apk');}

export interface StatusMessage {
	type: 'status';
	status: string;
	state: SessionState;
	serverUrl?: string;
	deviceName?: string;
}

export interface SessionNotice { type: 'notice'; id: number; message: string; level: 'info' | 'error'; }
export interface DevtoolsState {type: 'devtools'; active: boolean; enabled: boolean; connected: boolean; debugger?: DebuggerState;}
export type ExtensionMessage = {type: 'clipboard-text'; id: string; text: string} | import('./deviceTools').DeviceToolsState | import('./hierarchy').HierarchyHighlight | import('./inspector').InspectorResult | {type: 'expo-preference'; enabled: boolean} | ProjectInfo | LaunchProgress | import('./scan').ScanOutlines | DevtoolsState | StatusMessage | SessionNotice | { type: 'targets'; targets: EmulatorTarget[] } | UploadReply | UploadProgress;

export interface DisplayState {
	id: number;
	width: number;
	height: number;
	orientation: number;
	orientationCorrection?: number;
}

export interface DeviceVolume {
	current: number;
	min: number;
	max: number;
}

export interface ServerStatus {
	videoConnected: boolean;
	audioConnected: boolean;
	controlConnected: boolean;
	audioConfigured: boolean;
	audioPackets: number;
	agentError?: string;
}
