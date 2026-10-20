import * as React from 'react';
import type { DevtoolsState, EmulatorTarget, ExtensionMessage, StatusMessage, SessionNotice } from '../../../shared/protocol';
import { vscode } from '../../shared/vscode';

interface HostState {
	targets: EmulatorTarget[];
	selectedTarget: string;
	session: StatusMessage;
	notice?: SessionNotice;
	loadingStartedAt?: number;
}

type Action = Extract<ExtensionMessage, { type: 'targets' | 'status' | 'notice' }> | { type: 'select'; value: string } | {type: 'dismiss-notice'};

function reducer(state: HostState, message: Action): HostState {
	switch (message.type) {
		case 'targets': {
			const avdName = state.targets.find(target => target.value === state.selectedTarget)?.avdName
				?? (state.selectedTarget.startsWith('avd:') ? state.selectedTarget.slice(4) : undefined);
			return {
			...state,
			targets: message.targets,
			selectedTarget: message.targets.some(target => target.value === state.selectedTarget)
				? state.selectedTarget : message.targets.find(target => avdName && target.avdName === avdName)?.value ?? message.targets[0]?.value ?? '',
		};
		}
		case 'status': return { ...state, session: message, loadingStartedAt: message.state === 'online' ? state.loadingStartedAt ?? Date.now() : undefined };
		case 'notice': return {...state, notice: message};
		case 'dismiss-notice': return {...state, notice: undefined};
		case 'select': return { ...state, selectedTarget: message.value };
	}
}

export function useHostSession() {
	const [deviceTools, setDeviceTools] = React.useState<import('../../../shared/deviceTools').DeviceToolsState>({type: 'device-tools-state', busy: false});
	const [launchWithExpo, setLaunchWithExpo] = React.useState(false);
	const [project, setProject] = React.useState({expo: false, reactNative: false});
	const [launch, setLaunch] = React.useState({busy: false, status: ''});
	const [devtools, setDevtools] = React.useState<DevtoolsState>({type: 'devtools', active: false, enabled: false, connected: false});
	const [state, dispatch] = React.useReducer(reducer, {
		targets: [], selectedTarget: '', session: { type: 'status', state: 'idle', status: 'Select an emulator' },
	});
	React.useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data?.type === 'device-tools-state') {setDeviceTools(event.data);}
			if (event.data?.type === 'expo-preference') {setLaunchWithExpo(event.data.enabled);}
			if (event.data?.type === 'project-info') {setProject(event.data);}
			if (event.data?.type === 'launch-progress') {setLaunch(event.data);}
			if (event.data?.type === 'devtools') {setDevtools(event.data);}
			if (event.data?.type === 'targets' || event.data?.type === 'status' || event.data?.type === 'notice') {dispatch(event.data);}
		};
		window.addEventListener('message', handleMessage);
		vscode.postMessage({ type: 'ready' });
		const timer = window.setInterval(() => vscode.postMessage({type: 'devtools-refresh'}), 1500);
		return () => {window.clearInterval(timer); window.removeEventListener('message', handleMessage);};
	}, []);
	return {
		...state,
		devtools,
		deviceTools,
		deviceAction: (command: import('../../../shared/deviceTools').DeviceToolAction) => vscode.postMessage({type: 'device-tools', ...command}),
		showDevMenu: () => vscode.postMessage({type: 'dev-menu'}),
		setDebugging: (enabled: boolean) => vscode.postMessage({type: 'debugger-preference', enabled}),
		debuggerAction: (action: import('../../../shared/protocol').DebuggerAction) => vscode.postMessage({type: 'debugger', action}),
		lifecycle: (action: import('../../../shared/protocol').LifecycleAction) => {if (!launch.busy) {setLaunch({busy: true, status: {'reconnect-device': 'Reconnecting device…', 'reload': 'Reloading JS…', 'restart-app': 'Restarting app…', 'restart-metro': 'Restarting Metro…', 'clear-metro': 'Clearing Metro cache…', reinstall: 'Reinstalling app…', rebuild: 'Rebuilding app…', 'clean-rebuild': 'Clean rebuilding app…'}[action]}); vscode.postMessage({type: 'lifecycle', action});}},
		project, launch,
		launchWithExpo,
		setLaunchWithExpo: (enabled: boolean) => {setLaunchWithExpo(enabled); vscode.postMessage({type: 'expo-preference', enabled});},
		toggleScan: (enabled: boolean) => vscode.postMessage({type: 'scan-toggle', enabled}),
		startExpo: () => {if (state.selectedTarget) {
			setLaunch({busy: true, status: 'Starting Expo session…'});
			vscode.postMessage({type: 'start-expo', value: state.selectedTarget});
		}},
		selectTarget: (value: string) => dispatch({ type: 'select', value }),
		refreshTargets: React.useCallback(() => vscode.postMessage({ type: 'refresh' }), []),
		start: () => {if (state.selectedTarget) {vscode.postMessage({ type: 'start', value: state.selectedTarget });}},
		close: () => vscode.postMessage({ type: 'close' }),
		retry: () => vscode.postMessage({type: 'retry'}),
		dismissNotice: React.useCallback(() => dispatch({type: 'dismiss-notice'}), []),
	};
}
