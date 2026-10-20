// @vitest-environment node
import * as http from 'node:http';
import type {Socket} from 'node:net';
import {afterEach, expect, it} from 'vitest';
import {createInspectorTransport} from '../../src/host/reactNative/InspectorTransport';

const cleanup: Array<() => void> = [];
afterEach(() => {for (const close of cleanup.splice(0).reverse()) {close();}});
async function metro() {
	const sockets = new Set<Socket>();
	const server = http.createServer();
	server.on('connection', socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
	cleanup.push(() => {for (const socket of sockets) {socket.destroy();} server.close();});
	await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
	const port = (server.address() as {port: number}).port;
	return {server, port};
}
it('supplies the exact Metro Origin and relays traffic in both directions', async () => {
	const {server, port} = await metro();
	let origin: string | undefined, route: string | undefined;
	server.on('upgrade', (request, socket) => {
		origin = request.headers.origin; route = request.url;
		socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
		socket.on('data', data => socket.write(data));
	});
	const bridge = await createInspectorTransport(`ws://127.0.0.1:${port}/inspector/debug?device=abc&page=1`);
	cleanup.push(bridge.close);
	const url = new URL(bridge.websocket); url.protocol = 'http:';
	const result = await new Promise<string>((resolve, reject) => {
		const request = http.request(url, {headers: {Connection: 'Upgrade', Upgrade: 'websocket'}});
		request.on('error', reject);
		request.on('upgrade', (_response, socket) => {
			socket.on('error', reject);
			socket.once('data', data => {resolve(data.toString()); socket.destroy();});
			socket.write('debugger-message');
		});
		request.end();
	});
	expect(origin).toBe(`http://127.0.0.1:${port}`);
	expect(route).toBe('/inspector/debug?device=abc&page=1');
	expect(result).toBe('debugger-message');
});
it('rejects browser Origin headers and unknown local paths', async () => {
	const {port} = await metro();
	const bridge = await createInspectorTransport(`ws://127.0.0.1:${port}/inspector/debug?device=a&page=1`); cleanup.push(bridge.close);
	for (const browser of [true, false]) {
		const url = new URL(bridge.websocket); url.protocol = 'http:';
		if (!browser) {url.pathname = '/wrong-token';}
		const status = await new Promise<number | undefined>((resolve, reject) => {
			const request = http.request(url, {headers: {Connection: 'Upgrade', Upgrade: 'websocket', ...(browser ? {Origin: 'https://example.com'} : {})}}, response => {response.resume(); resolve(response.statusCode);});
			request.on('error', reject); request.end();
		});
		expect(status).toBe(403);
	}
});
it('refuses non-loopback and non-inspector destinations', async () => {
	await expect(createInspectorTransport('ws://example.com:8081/inspector/debug')).rejects.toThrow('loopback');
	await expect(createInspectorTransport('ws://127.0.0.1:8081/other')).rejects.toThrow('loopback');
});
