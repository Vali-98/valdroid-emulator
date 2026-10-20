// @vitest-environment node
import {buildSync} from 'esbuild';
import * as vm from 'node:vm';
import * as path from 'node:path';
import {expect, it} from 'vitest';
import {fitScanOutlines, parseScanOutlines} from '../../src/shared/scan';

it('measures Fabric views, batches pixel coordinates and stops posting when disabled', async () => {
	const code = buildSync({entryPoints: [path.resolve('src/runtime/reactScan.js')], bundle: true, platform: 'browser', format: 'cjs', external: ['react-native', 'react-scan/dist/index.mjs'], write: false}).outputFiles[0].text;
	let render: ((fiber: object, renders: object[]) => void) | undefined;
	let flush: (() => Promise<void>) | undefined;
	let poll: (() => Promise<void>) | undefined;
	let enabled = true;
	const batches: unknown[] = [];
	const paused = {value: true};
	const sandbox = {
		module: {exports: {} as {startScan: (url: string) => void}}, console: {...console},
		require: (name: string) => name === 'react-native' ? {
			Dimensions: {get: () => ({width: 400, height: 800})}, PixelRatio: {get: () => 2}, Platform: {OS: 'android'}, StatusBar: {currentHeight: 24},
		} : {ReactScanInternals: {}, createInstrumentation: (_id: string, config: {onRender: typeof render}) => {render = config.onRender; return {isPaused: paused};}},
		setInterval: (callback: () => Promise<void>) => {flush = callback;},
		setTimeout: (callback: () => Promise<void>, milliseconds: number) => {if (milliseconds === 750) {poll = callback;} return 1;},
		clearTimeout() {},
		fetch: async (_url: string, options?: {body: string}) => {if (options) {batches.push(JSON.parse(options.body));} return {json: async () => ({enabled})};},
	};
	vm.runInNewContext(code, sandbox);
	sandbox.module.exports.startScan('http://localhost/token');
	await new Promise(resolve => setTimeout(resolve, 0));
	const host = {measureInWindow: (callback: (...rect: number[]) => void) => callback(10, 20, 30, 40)};
	const fiber = {tag: 5, stateNode: {canonical: {publicInstance: host}}};
	render?.(fiber, [{phase: 2, componentName: 'Button', didCommit: true}]);
	await flush?.();
	expect(batches).toHaveLength(1);
	const batch = parseScanOutlines(batches[0]);
	expect(batch?.outlines[0]).toMatchObject({name: 'Button', x: 20, y: 40, width: 60, height: 80});
	enabled = false; await poll?.();
	render?.(fiber, [{phase: 2, componentName: 'Button', didCommit: true}]); await flush?.();
	expect(batches).toHaveLength(1);
	expect(paused.value).toBe(true);
});

it('rejects malformed or oversized rectangle batches', () => {
	expect(parseScanOutlines({type: 'scan-outlines', width: 0, height: 100, outlines: []})).toBeUndefined();
	expect(parseScanOutlines({type: 'scan-outlines', width: 100, height: 100, outlines: [{id: 1, name: 'x', x: NaN}]})).toBeUndefined();
});

it('aligns rectangles with contained video including letterboxing', () => {
	const batch = {type: 'scan-outlines' as const, width: 400, height: 800, outlines: [{id: 1, name: 'Button', count: 1, x: 10, y: 20, width: 30, height: 40, didCommit: 1 as const}]};
	expect(fitScanOutlines(batch, 400, 400)[0]).toMatchObject({x: 105, y: 10, width: 15, height: 20});
});

it('detects a commit through patched upstream instrumentation without a DOM', async () => {
	const code = buildSync({entryPoints: [path.resolve('src/runtime/reactScan.js')], bundle: true, platform: 'browser', format: 'cjs', external: ['react-native'], write: false}).outputFiles[0].text;
	let flush: (() => Promise<void>) | undefined;
	const batches: unknown[] = [];
	const sandbox: Record<string, unknown> = {
		module: {exports: {}}, console: {...console}, performance,
		navigator: {product: 'ReactNative'},
		require: () => ({Dimensions: {get: () => ({width: 400, height: 800})}, PixelRatio: {get: () => 1}, Platform: {OS: 'android'}, StatusBar: {currentHeight: 0}}),
		setTimeout: () => 1, clearTimeout() {}, setInterval: (callback: () => Promise<void>) => {flush = callback; return 1;},
		requestAnimationFrame: () => 1, cancelAnimationFrame() {},
		fetch: async (_url: string, options?: {body: string}) => {if (options) {batches.push(JSON.parse(options.body));} return {json: async () => ({enabled: true})};},
	};
	sandbox.window = sandbox; sandbox.globalThis = sandbox;
	vm.runInNewContext(code, sandbox);
	const exports = (sandbox.module as {exports: {startScan: (url: string) => void}}).exports;
	expect(() => exports.startScan('http://localhost/token')).not.toThrow();
	expect(sandbox.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeDefined();
	await new Promise(resolve => setTimeout(resolve, 0));
	const hook = sandbox.__REACT_DEVTOOLS_GLOBAL_HOOK__ as {inject: (renderer: object) => number; onCommitFiberRoot: (id: number, root: object) => void};
	const id = hook.inject({version: '19.1.0', bundleType: 1});
	const base = {flags: 1, subtreeFlags: 1, alternate: null, memoizedProps: {}, memoizedState: null, sibling: null, actualDuration: 1, selfBaseDuration: 1, treeBaseDuration: 1};
	const host = {...base, tag: 5, type: 'RCTView', child: null, stateNode: {canonical: {publicInstance: {measureInWindow: (callback: (...rect: number[]) => void) => callback(10, 20, 30, 40)}}}};
	const component = {...base, tag: 0, type: function Button() {}, child: host};
	const root = {...base, tag: 3, type: null, memoizedState: {element: {}}, child: component};
	hook.onCommitFiberRoot(id, {current: root});
	await flush?.();
	expect(parseScanOutlines(batches[0])?.outlines[0]).toMatchObject({name: 'Button', x: 10, y: 20, width: 30, height: 40});
});
