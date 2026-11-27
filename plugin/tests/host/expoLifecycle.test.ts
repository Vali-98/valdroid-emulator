// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as vm from 'node:vm';
import {expect, it, vi} from 'vitest';

it.each(['build', 'clean-build', 'launch'])('initializes the Expo environment with an explicit mode before %s', async phase => {
	const loadEnvFiles = vi.fn((_root: string, options: {mode: string}) => {
		if (options.mode !== 'development') {throw new Error('Expected explicit development mode');}
	});
	const resolveDeviceAsync = vi.fn(async () => ({identifier: 'another-device'}));
	const fromProject = Object.assign((file: string) => {
		// Deliberately omit setNodeEnv: Expo's environment loader owns that step.
		if (file.endsWith('nodeEnv.js')) {return {loadEnvFiles};}
		if (file.endsWith('resolveDevice.js')) {return {resolveDeviceAsync};}
		throw new Error(`Unexpected Expo API: ${file}`);
	}, {resolve: () => '/project/node_modules/@expo/cli/package.json'});
	const originalRequire = createRequire(import.meta.url);
	const sandbox = {module: {exports: {} as {runPhase: (...args: unknown[]) => Promise<void>}},
		require: (name: string) => name === 'node:module' ? {createRequire: () => fromProject} : originalRequire(name)};
	vm.runInNewContext(readFileSync('src/runtime/expoLifecycle.cjs', 'utf8'), sandbox);
	// Stop at device validation, before any build, install or launch side effects.
	await expect(sandbox.module.exports.runPhase(phase, '/storage/state.json', '/project', '/project/cli', 'Phone', 'emulator-5554', 8081)).rejects.toThrow('Refusing to use another device');
	expect(loadEnvFiles).toHaveBeenCalledExactlyOnceWith('/project', {mode: 'development'});
	expect(loadEnvFiles.mock.invocationCallOrder[0]).toBeLessThan(resolveDeviceAsync.mock.invocationCallOrder[0]);
});
