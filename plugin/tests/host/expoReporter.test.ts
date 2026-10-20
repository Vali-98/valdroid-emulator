// @vitest-environment node
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {expect, it, vi} from 'vitest';

it('filters only client log events through the named Expo reporter export', () => {
	class Reporter {shouldFilterClientLog() {return false;}}
	const stderr = vi.fn();
	const fromProject = Object.assign(() => ({MetroTerminalReporter: Reporter}), {resolve: () => '/project/node_modules/@expo/cli/package.json'});
	vm.runInNewContext(readFileSync('src/runtime/expoReporter.cjs', 'utf8'), {
		require: (name: string) => name === 'node:module' ? {createRequire: () => fromProject} : name === 'node:worker_threads' ? {isMainThread: true} : path,
		process: {pid: 100, env: {}, argv: ['node', '/project/node_modules/expo/bin/cli'], stderr: {write: stderr}},
	});
	expect(new Reporter().shouldFilterClientLog()).toBe(true);
	expect(stderr).not.toHaveBeenCalled();
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
