export interface HermesTarget {id: string; title: string; deviceName?: string; websocket: string;}

export function parseHermesTargets(value: unknown, port: number, applicationId: string): HermesTarget[] {
	if (!Array.isArray(value)) {throw new Error('Metro returned an invalid inspector target list.');}
	return value.flatMap(item => {
		if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.webSocketDebuggerUrl !== 'string' ||
			(item.appId ?? item.description) !== applicationId || item.vm === "don't use") {return [];}
		try {
			const url = new URL(item.webSocketDebuggerUrl);
			if (url.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== String(port) || url.pathname !== '/inspector/debug' || !url.searchParams.has('device') || !url.searchParams.has('page') || url.username || url.password) {return [];}
			url.hostname = '127.0.0.1';
			return [{id: item.id, title: typeof item.title === 'string' ? item.title : applicationId, deviceName: typeof item.deviceName === 'string' ? item.deviceName : undefined, websocket: url.href}];
		} catch {return [];}
	});
}

export function hermesDebugConfiguration(root: string, websocket: string, token: string, metroWebsocket = websocket) {
	const port = new URL(metroWebsocket).port;
	const sourceMapPathOverrides: Record<string, string> = {'webpack:///./*': root + '/*', 'metro:///*': root + '/*'};
	// Metro's sourcePaths=url-server serializes project files as server routes,
	// not disk paths. Match only this session's origins; don't strip arbitrary URLs.
	for (const prefix of ['', ...['127.0.0.1', 'localhost', '10.0.2.2', '10.0.3.2', '[::1]'].map(host => `http://${host}:${port}`)]) {
		for (const route of ['/[metro-project]/', '/%5Bmetro-project%5D/']) {
			sourceMapPathOverrides[`${prefix}${route}*`] = root + '/*';
		}
	}
	return {
		type: 'pwa-node', request: 'attach', name: 'Valdroid: Hermes',
		websocketAddress: websocket, cwd: root, sourceMaps: true,
		resolveSourceMapLocations: [root + '/**', 'http://127.0.0.1:*/**', 'http://localhost:*/**', 'http://10.0.2.2:*/**'],
		sourceMapPathOverrides,
		localRoot: root, remoteRoot: root,
		outFiles: [], restart: false, autoAttachChildProcesses: false,
		continueOnAttach: false, enableContentValidation: false,
		internalConsoleOptions: 'neverOpen', __valdroidDebug: token,
	};
}
