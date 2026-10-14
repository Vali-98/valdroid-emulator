import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { vi } from 'vitest';

export function queryWrapper() {
	const client = new QueryClient({ defaultOptions: {
		queries: { retry: false, gcTime: 0, networkMode: 'always' },
		mutations: { retry: false, gcTime: 0, networkMode: 'always' },
	} });
	return ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export class MockSocket {
	static OPEN = 1;
	static instances: MockSocket[] = [];
	readyState = 1;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
	send = vi.fn();
	close = vi.fn(() => {this.readyState = 3; this.onclose?.();});
	constructor(readonly url: string) {MockSocket.instances.push(this);}
}

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
	return { promise, resolve, reject };
}
