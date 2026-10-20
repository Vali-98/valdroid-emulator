// @vitest-environment node
import {buildSync} from 'esbuild';
import * as vm from 'node:vm';
import * as path from 'node:path';
import {expect, it, vi} from 'vitest';
import {parseInspectorResult} from '../../src/shared/inspector';

function runtime(nestedConfig = true) {
	const code = buildSync({entryPoints: [path.resolve('src/runtime/elementInspector.js')], bundle: true, external: ['react-native'], format: 'cjs', write: false}).outputFiles[0].text;
	const previous = vi.fn();
	const hitTest = vi.fn((_host: unknown, _x: number, _y: number, callback: (data: unknown) => void) => callback({hierarchy: [{name: 'Card'}], closestInstance: {type: {name: 'Card'}, _debugSource: {fileName: 'Card.tsx', lineNumber: 8, columnNumber: 3}, _debugOwner: {type: {name: 'Screen'}}}, frame: {left: 10, top: 20, width: 80, height: 40}}));
	// Current RN injects inspection methods under rendererConfig, not at top level.
	const config = {getInspectorDataForViewAtPoint: hitTest};
	const hook = {onCommitFiberRoot: previous, renderers: new Map<number, object>([[1, nestedConfig ? {rendererConfig: config} : config]])};
	const host = {measureInWindow: (callback: (...args: number[]) => void) => callback(0, 0, 400, 760)};
	const root = {current: {child: {tag: 5, stateNode: {canonical: {publicInstance: host}}}}};
	const sandbox = {module: {exports: {} as {installElementInspector: () => (request: {id: number; x: number; y: number}) => Promise<unknown>}}, require: () => ({Dimensions: {get: (name: string) => ({width: 400, height: name === 'screen' ? 800 : 760})}, Platform: {OS: 'android'}, StatusBar: {currentHeight: 24}}), __REACT_DEVTOOLS_GLOBAL_HOOK__: hook, setTimeout, clearTimeout};
	vm.runInNewContext(code, sandbox);
	return {...sandbox.module.exports, hook, root, hitTest, previous};
}

it('uses native hit-testing, keeps the existing hook, and returns bounded owner/source metadata', async () => {
	const r = runtime();
	const inspect = r.installElementInspector();
	r.hook.onCommitFiberRoot(1, r.root);
	expect(r.previous).toHaveBeenCalledWith(1, r.root);
	const result = parseInspectorResult(await inspect({id: 1, x: 0.5, y: 0.5}));
	expect(r.hitTest.mock.calls[0].slice(1, 3)).toEqual([200, 376]);
	expect(result?.frame).toEqual({x: 10, y: 44, width: 80, height: 40});
	expect(result?.elements.map(element => element.name)).toEqual(['Card', 'Screen']);
	expect(result?.elements[0].source?.fileName).toBe('Card.tsx');
});

it('returns an explicit empty hit and does not inspect an unmounted root', async () => {
	const r = runtime();
	const inspect = r.installElementInspector();
	r.hook.onCommitFiberRoot(1, r.root);
	r.root.current.child = null as never;
	r.hook.onCommitFiberRoot(1, r.root);
	const result = parseInspectorResult(await inspect({id: 2, x: 0.5, y: 0.5}));
	expect(r.hitTest).not.toHaveBeenCalled();
	expect(result?.error).toContain('No React component');
});

it('also supports older renderers exposing inspector methods at top level', async () => {
	const r = runtime(false);
	const inspect = r.installElementInspector();
	r.hook.onCommitFiberRoot(1, r.root);
	expect(parseInspectorResult(await inspect({id: 1, x: 0.5, y: 0.5}))?.elements[0].name).toBe('Card');
});
