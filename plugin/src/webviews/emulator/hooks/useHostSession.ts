import * as React from 'react';
import type { EmulatorTarget, ExtensionMessage, StatusMessage, SessionNotice } from '../../../shared/protocol';
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
	const [state, dispatch] = React.useReducer(reducer, {
		targets: [], selectedTarget: '', session: { type: 'status', state: 'idle', status: 'Select an emulator' },
	});
	React.useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data?.type === 'targets' || event.data?.type === 'status' || event.data?.type === 'notice') {dispatch(event.data);}
		};
		window.addEventListener('message', handleMessage);
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, []);
	return {
		...state,
		selectTarget: (value: string) => dispatch({ type: 'select', value }),
		refreshTargets: () => vscode.postMessage({ type: 'refresh' }),
		start: () => {if (state.selectedTarget) {vscode.postMessage({ type: 'start', value: state.selectedTarget });}},
		close: () => vscode.postMessage({ type: 'close' }),
		retry: () => vscode.postMessage({type: 'retry'}),
		dismissNotice: React.useCallback(() => dispatch({type: 'dismiss-notice'}), []),
	};
}
