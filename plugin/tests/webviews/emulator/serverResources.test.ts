import { expect, it, vi } from 'vitest';
import { createResourceSampler } from '../../../src/webviews/emulator/hooks/useServerResources';

const snapshot = (pid: number, sampledAtMs: number, cpuTimeNs: number) => ({pid, sampledAtMs, cpuTimeNs});
const fetchSamples = (...samples: object[]) => vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({ok: true, json: async () => samples.shift()})));

it('calculates process CPU across successful samples and resets when the process changes', async () => {
	fetchSamples(snapshot(1, 1000, 1000000), snapshot(1, 2000, 201000000), snapshot(2, 3000, 500000));
	const sample = createResourceSampler('http://localhost');
	const input = {signal: new AbortController().signal};
	expect((await sample(input)).cpuPercent).toBeUndefined();
	expect((await sample(input)).cpuPercent).toBe(20);
	expect((await sample(input)).cpuPercent).toBeUndefined();
});

it('does not let a canceled observation change the next CPU calculation', async () => {
	fetchSamples(snapshot(1, 1000, 0), snapshot(2, 1500, 0), snapshot(1, 2000, 100000000));
	const sample = createResourceSampler('http://localhost');
	await sample({signal: new AbortController().signal});
	const canceled = new AbortController(); canceled.abort();
	await expect(sample({signal: canceled.signal})).rejects.toThrow();
	expect((await sample({signal: new AbortController().signal})).cpuPercent).toBe(10);
});
