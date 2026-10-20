import * as http from 'node:http';
import type {Socket} from 'node:net';
import {randomUUID} from 'node:crypto';

// js-debug's Node transport omits Origin. Forward only the selected inspector
// handshake, adding Metro's expected Origin without changing its security policy.
export async function createInspectorTransport(endpoint: string, log: (message: string) => void = () => undefined) {
	const target = new URL(endpoint);
	if (target.protocol !== 'ws:' || target.hostname !== '127.0.0.1' || !target.port || target.pathname !== '/inspector/debug' || target.username || target.password) {throw new Error('Expected an owned loopback Metro inspector endpoint.');}
	const route = `/${randomUUID()}`;
	const sockets = new Set<Socket>();
	const server = http.createServer((_request, response) => response.writeHead(404).end());
	server.on('connection', socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
	server.on('upgrade', (request, client, head) => {
		// Browser websocket connections include Origin; never allow web pages to
		// use this local bridge to bypass Metro's origin validation.
		if (request.url !== route || request.headers.origin !== undefined || request.headers.upgrade?.toLowerCase() !== 'websocket') {client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;}
		const upstream = http.request({hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: 'GET', headers: {...request.headers, host: target.host, origin: `http://${target.host}`}});
		upstream.setTimeout(5000, () => upstream.destroy(new Error('Metro inspector handshake timed out.')));
		client.on('error', () => upstream.destroy());
		client.on('close', () => upstream.destroy());
		upstream.on('error', error => {log(`[Valdroid] Inspector connection error: ${error.message}\n`); client.destroy();});
		upstream.on('response', response => {log(`[Valdroid] Inspector handshake rejected: HTTP ${response.statusCode}\n`); response.resume(); client.end(`HTTP/1.1 ${response.statusCode ?? 502} Inspector connection failed\r\nConnection: close\r\n\r\n`);});
		upstream.on('upgrade', (response, socket, upstreamHead) => {
			log('[Valdroid] Hermes inspector websocket connected.\n');
			upstream.setTimeout(0);
			sockets.add(socket); socket.on('close', () => sockets.delete(socket));
			socket.on('error', () => client.destroy()); client.on('error', () => socket.destroy());
			socket.on('close', () => client.destroy()); client.on('close', () => socket.destroy());
			client.write(`HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders.reduce((lines, value, index) => lines + (index % 2 ? `${value}\r\n` : `${value}: `), '')}\r\n`);
			if (upstreamHead.length) {client.write(upstreamHead);}
			if (head.length) {socket.write(head);}
			client.pipe(socket); socket.pipe(client);
		});
		upstream.end();
	});
	await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
	const address = server.address();
	if (!address || typeof address === 'string') {server.close(); throw new Error('Could not allocate inspector transport.');}
	return {websocket: `ws://127.0.0.1:${address.port}${route}`, close: () => {for (const socket of sockets) {socket.destroy();} server.close();}};
}
