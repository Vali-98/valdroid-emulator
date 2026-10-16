// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitForServerAddress } from '../../src/host/session/serverConnection';

class FakeChild extends EventEmitter {
	stdout = new PassThrough();
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
}

let child: FakeChild;
beforeEach(() => {vi.useFakeTimers(); child = new FakeChild();});
afterEach(() => {child.stdout.destroy(); vi.useRealTimers();});
const wait = () => waitForServerAddress(child as unknown as ChildProcess);
const announce = (httpUrl = 'http://127.0.0.1:54321') =>
	JSON.stringify({ type: 'server-listening', httpUrl, socketAddress: '127.0.0.1:54322' }) + '\n';

it('reads fragmented JSON and uses the announced URL rather than a preferred port', async () => {
	const pending = wait();
	const line = announce();
	child.stdout.write(line.slice(0, 20)); child.stdout.write(line.slice(20));
	await expect(pending).resolves.toBe('http://127.0.0.1:54321');
	expect(child.listenerCount('exit')).toBe(0);
	expect(child.listenerCount('error')).toBe(0);
	expect(child.stdout.isPaused()).toBe(false);
	expect(vi.getTimerCount()).toBe(0);
});

it('ignores logs, unrelated messages, and JSON primitives', async () => {
	const pending = wait();
	child.stdout.write('Starting server\nnull\n42\n{"type":"other"}\n');
	child.stdout.write(announce());
	await expect(pending).resolves.toBe('http://127.0.0.1:54321');
});

it.each(['http://example.com:1234', 'http://0.0.0.0:1234', 'https://127.0.0.1:1234',
	'http://127.0.0.1:0', 'http://127.0.0.1:1234/api/status', 'http://user:pass@127.0.0.1:1234',
	'http://127.0.0.1:1234/?other=true', 'not a URL'])('rejects unexpected listener URL %s', async address => {
	const pending = wait(); child.stdout.write(announce(address));
	await expect(pending).rejects.toThrow('invalid HTTP listener');
	expect(vi.getTimerCount()).toBe(0);
});

it('reports spawn errors promptly and removes its listeners', async () => {
	const pending = wait(); child.emit('error', new Error('spawn ENOENT'));
	await expect(pending).rejects.toThrow('spawn ENOENT');
	expect(child.listenerCount('exit')).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

it('fails promptly when the child exits or was already terminated', async () => {
	const pending = wait(); child.emit('exit', 1, null);
	await expect(pending).rejects.toThrow('before announcing its ports (1)');
	child.signalCode = 'SIGTERM';
	await expect(wait()).rejects.toThrow('SIGTERM');
});

it('times out old or stalled servers without retaining process listeners', async () => {
	const pending = wait();
	const rejection = expect(pending).rejects.toThrow('Rebuild the bundled control server');
	await vi.advanceTimersByTimeAsync(15000); await rejection;
	expect(child.listenerCount('exit')).toBe(0);
	expect(child.listenerCount('error')).toBe(0);
});
