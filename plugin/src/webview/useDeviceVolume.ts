import * as React from 'react';

interface DeviceVolume {
	current: number;
	min: number;
	max: number;
}

export function useDeviceVolume(serverUrl: string, gainRef: React.MutableRefObject<GainNode | undefined>): () => void {
	const refresh = React.useCallback(() => {
		if (!serverUrl) {return;}
		void fetch(`${serverUrl}/api/volume`, { cache: 'no-store' }).then(async response => {
			if (!response.ok) {return;}
			const volume = await response.json() as DeviceVolume;
			const gain = gainRef.current;
			if (!gain || volume.max <= volume.min) {return;}
			const level = Math.max(0, Math.min(1, (volume.current - volume.min) / (volume.max - volume.min)));
			gain.gain.setTargetAtTime(level, gain.context.currentTime, 0.04);
		}).catch(() => undefined);
	}, [serverUrl, gainRef]);

	React.useEffect(() => {
		if (!serverUrl) {return;}
		refresh();
		const interval = window.setInterval(refresh, 1000);
		return () => window.clearInterval(interval);
	}, [serverUrl, refresh]);
	return refresh;
}
