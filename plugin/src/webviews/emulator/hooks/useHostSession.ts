import * as React from 'react';
import type { EmulatorTarget, ExtensionMessage, StatusMessage } from '../../../shared/protocol';
import { vscode } from '../../shared/vscode';

interface HostState {
	targets: EmulatorTarget[];
	selectedTarget: string;
	session: StatusMessage;
}

type Action = Extract<ExtensionMessage, { type: 'targets' | 'status' }> | { type: 'select'; value: string };

function reducer(state: HostState, message: Action): HostState {
	switch (message.type) {
		case 'targets': return {
			...state,
			targets: message.targets,
			selectedTarget: message.targets.some(target => target.value === state.selectedTarget)
				? state.selectedTarget : message.targets[0]?.value ?? '',
		};
		case 'status': return { ...state, session: message };
		case 'select': return { ...state, selectedTarget: message.value };
	}
}

export function useHostSession() {
	const [state, dispatch] = React.useReducer(reducer, {
		targets: [], selectedTarget: '', session: { type: 'status', state: 'idle', status: 'Select an emulator' },
	});
	React.useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data?.type === 'targets' || event.data?.type === 'status') {dispatch(event.data);}
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
	};
}
