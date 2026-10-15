export function createControlSender(socket: WebSocket) {
	let pending: object | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastMove = -Infinity;
	const clear = () => {if (timer !== undefined) {clearTimeout(timer); timer = undefined;}};
	const transmit = (command: object) => {
		if (socket.readyState !== WebSocket.OPEN) {return false;}
		try {socket.send(JSON.stringify(command)); return true;} catch {return false;}
	};
	const flush = () => {
		timer = undefined;
		if (!pending || socket.readyState !== WebSocket.OPEN) {pending = undefined; return;}
		if (socket.bufferedAmount > 0) {timer = setTimeout(flush, 4); return;}
		const command = pending; pending = undefined;
		if (transmit(command)) {lastMove = performance.now();}
	};
	return {
		send(command: object): boolean {
			if (socket.readyState !== WebSocket.OPEN) {return false;}
			const input = command as { type?: string; action?: number };
			if (input.type === 'motion' && input.action === 2) {
				const delay = Math.max(0, 1000 / 120 - (performance.now() - lastMove));
				if (delay > 0 || socket.bufferedAmount > 0) {
					pending = command;
					if (timer === undefined) {timer = setTimeout(flush, Math.max(4, delay));}
					return true;
				}
				lastMove = performance.now();
			}
			// Never put down/up/cancel/key events behind a timer or a stale pending move.
			pending = undefined; clear();
			return transmit(command);
		},
		dispose() {pending = undefined; clear();},
	};
}
