export interface EmulatorTarget {
	label: string;
	value: string;
}

export type SessionState = 'idle' | 'online' | 'error';

export type HostMessage =
	| { type: 'ready' | 'refresh' | 'stop' | 'close' }
	| { type: 'start'; value: string };

export interface StatusMessage {
	type: 'status';
	status: string;
	state: SessionState;
	serverUrl?: string;
	deviceName?: string;
}

export type ExtensionMessage = StatusMessage | { type: 'targets'; targets: EmulatorTarget[] };

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
