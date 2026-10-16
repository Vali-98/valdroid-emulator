import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

interface Resources {
	pid: number;
	sampledAtMs: number;
	cpuTimeNs?: number;
	heapAllocBytes: number;
	heapReservedBytes: number;
	goroutines: number;
	gcCycles: number;
}

// A sampler owns its previous successful observation, not a second React state.
export function createResourceSampler(serverUrl: string) {
	let previous: Resources | undefined;
	return async ({ signal }: { signal: AbortSignal }) => {
		const response = await fetch(new URL('/api/resources', serverUrl), {signal, cache: 'no-store'});
		if (!response.ok) {throw new Error(`Server resources: ${response.status}`);}
		const data = await response.json() as Resources;
		signal.throwIfAborted();
		const before = previous;
		previous = data;
		const cpuPercent = before && data.pid === before.pid && data.cpuTimeNs !== undefined && before.cpuTimeNs !== undefined
			&& data.sampledAtMs > before.sampledAtMs && data.cpuTimeNs >= before.cpuTimeNs
			? (data.cpuTimeNs - before.cpuTimeNs) / ((data.sampledAtMs - before.sampledAtMs) * 1e6) * 100 : undefined;
		return {...data, cpuPercent};
	};
}

export function useServerResources(serverUrl: string) {
	const sample = useMemo(() => createResourceSampler(serverUrl), [serverUrl]);
	return useQuery({queryKey: [serverUrl, '/api/resources'], enabled: Boolean(serverUrl),
		queryFn: sample, refetchInterval: 2000});
}
