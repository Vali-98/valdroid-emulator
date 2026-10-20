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
		require: (name: string) => name === 'node:module' ? {createRequire: () => fromProject} : path,
		process: {argv: ['node', '/project/node_modules/expo/bin/cli'], stderr: {write: stderr}},
	});
	expect(new Reporter().shouldFilterClientLog()).toBe(true);
	expect(stderr).not.toHaveBeenCalled();
});
