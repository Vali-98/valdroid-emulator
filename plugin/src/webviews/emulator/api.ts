import { QueryClient, useQuery } from '@tanstack/react-query';

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false, gcTime: 0, networkMode: 'always', refetchOnWindowFocus: false },
		mutations: { retry: false, gcTime: 0, networkMode: 'always' },
	},
});

export function socketUrl(serverUrl: string, endpoint: string): string {
	const url = new URL(endpoint, serverUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

export function useDeviceQuery<T>(serverUrl: string, endpoint: string, interval: number) {
	return useQuery({
		queryKey: [serverUrl, endpoint],
		enabled: Boolean(serverUrl),
		refetchInterval: interval,
		queryFn: async ({ signal }): Promise<T> => {
			const response = await fetch(new URL(endpoint, serverUrl), { signal, cache: 'no-store' });
			if (!response.ok) {throw new Error(`${endpoint}: ${response.status}`);}
			return response.json() as Promise<T>;
		},
	});
}
