export interface EmulatorTarget {
	label: string;
	value: string;
}

export type SessionState = 'idle' | 'online' | 'error';

export type HostMessage =
	| { type: 'ready' | 'refresh' | 'stop' | 'close' }
	| { type: 'start'; value: string }
	| UploadRequest;

export type UploadCommand =
	| { type: 'upload-start'; id: string; name: string; size: number }
	| { type: 'upload-chunk'; id: string; offset: number; data: string }
	| { type: 'upload-finish'; id: string }
	| { type: 'upload-cancel'; id: string };

export type UploadRequest = UploadCommand & { requestId: string };
export type UploadReply = { type: 'upload-result'; id: string; requestId: string; path?: string; error?: string };
export type UploadProgress = { type: 'upload-progress'; id: string; percent: number };
export const uploadChunkSize = 256 * 1024;
export const maxUploadSize = 4 * 1024 * 1024 * 1024;

export interface StatusMessage {
	type: 'status';
	status: string;
	state: SessionState;
	serverUrl?: string;
	deviceName?: string;
}

export type ExtensionMessage = StatusMessage | { type: 'targets'; targets: EmulatorTarget[] } | UploadReply | UploadProgress;

export interface DisplayState {
	id: number;
	width: number;
	height: number;
	orientation: number;
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
