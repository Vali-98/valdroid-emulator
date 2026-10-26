// @vitest-environment node
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {expect, it, vi} from 'vitest';

it('preserves reporting and sends structured bundle failures and recovery without console parsing', async () => {
	const update = vi.fn();
	class Reporter {shouldFilterClientLog() {return false;} update(event: unknown) {update(event);}}
	const stderr = vi.fn();
	const send = vi.fn();
	class HmrServer {async _prepareMessage(message: {type: string}) {return message;}}
	const fromProject = Object.assign((file: string) => file.endsWith('HmrServer.js') ? {default: HmrServer} : {MetroTerminalReporter: Reporter}, {resolve: () => '/project/node_modules/@expo/cli/package.json'});
	vm.runInNewContext(readFileSync('src/runtime/expoReporter.cjs', 'utf8'), {
		require: (name: string) => name === 'node:module' ? {createRequire: () => fromProject} : name === 'node:worker_threads' ? {isMainThread: true} : path,
		process: {pid: 100, connected: true, send, env: {}, argv: ['node', '/project/node_modules/expo/bin/cli'], stderr: {write: stderr}},
	});
	expect(new Reporter().shouldFilterClientLog()).toBe(true);
	expect(stderr).not.toHaveBeenCalled();
	const event = {type: 'bundling_error', error: {message: 'Unexpected token', filename: '/project/app.tsx', loc: {line: 7, column: 4}}};
	new Reporter().update(event);
	expect(send).toHaveBeenCalledWith({type: 'valdroid-bundle-error', message: 'Unexpected token', file: '/project/app.tsx', line: 7, column: 4}, expect.any(Function));
	expect(update).toHaveBeenCalledWith(event);
	new Reporter().update({type: 'client_log', data: ['error is just app text']});
	expect(send).toHaveBeenCalledTimes(1);
	new Reporter().update({type: 'bundle_build_done'});
	expect(send).toHaveBeenLastCalledWith({type: 'valdroid-bundle-ready'}, expect.any(Function));
	send.mockClear();
	await new HmrServer()._prepareMessage({type: 'error'});
	expect(send).not.toHaveBeenCalled();
	await new HmrServer()._prepareMessage({type: 'update'});
	expect(send).toHaveBeenLastCalledWith({type: 'valdroid-bundle-ready'}, expect.any(Function));
});

it.each([{pid: 101, isMainThread: true}, {pid: 100, isMainThread: false}])('skips inherited preloads in Metro workers: %j', worker => {
	const load = vi.fn(() => {throw new Error('Worker has no Expo reporter');});
	const stderr = vi.fn();
	for (const file of ['expoReporter.cjs', 'metroPreload.cjs']) {
		vm.runInNewContext(readFileSync(`src/runtime/${file}`, 'utf8'), {
			require: (name: string) => name === 'node:module' ? {createRequire: load}
				: name === 'node:worker_threads' ? {isMainThread: worker.isMainThread}
				: name === './metroIntegration.cjs' ? {installMetroIntegration: load} : path,
			process: {pid: worker.pid, env: {VALDROID_METRO_PID: '100', VALDROID_METRO_SESSION: '/storage/session.json'}, argv: ['node', '/metro/worker.js'], stderr: {write: stderr}},
		});
	}
	expect(load).not.toHaveBeenCalled();
	expect(stderr).not.toHaveBeenCalled();
});
