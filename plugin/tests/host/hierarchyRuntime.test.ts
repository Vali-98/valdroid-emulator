// @vitest-environment node
import {buildSync} from 'esbuild';
import * as vm from 'node:vm';
import * as path from 'node:path';
import {expect, it, vi} from 'vitest';
import {parseHierarchySnapshot, parseHierarchyHighlight} from '../../src/shared/hierarchy';

function fixture() {
	const code = buildSync({entryPoints: [path.resolve('src/runtime/hierarchy.js')], bundle: true, external: ['react-native'], format: 'cjs', write: false}).outputFiles[0].text;
	const module = {exports: {} as {createHierarchy: (getRoots: () => unknown[], topInset: () => number) => {getID: (fiber: object) => string; update: (control: object) => Promise<unknown[]>}}};
	vm.runInNewContext(code, {module, require: () => ({Dimensions: {get: () => ({width: 400, height: 800})}}), setTimeout, clearTimeout});
	const measure = vi.fn((callback: (...args: number[]) => void) => callback(10, 20, 100, 50));
	const host = {tag: 5, type: 'RCTView', memoizedProps: {}, stateNode: {canonical: {publicInstance: {measureInWindow: measure}}}};
	const getter = vi.fn(() => 'must not evaluate');
	const props = Object.defineProperty({title: 'Hello', items: [1, {active: true}]}, 'secret', {get: getter});
	const card = {tag: 0, type: {name: 'Card'}, memoizedProps: props, child: host};
	const root = {current: {child: card}};
	const roots = vi.fn(() => [root]);
	return {controller: module.exports.createHierarchy(roots, () => 24), root, roots, card, host, getter, measure};
}

it('does not traverse or serialize anything until the hierarchy is active', async () => {
	const f = fixture();
	expect(await f.controller.update({active: false, version: 0})).toEqual([]);
	expect(f.roots).not.toHaveBeenCalled();
	expect(f.getter).not.toHaveBeenCalled();
	const events = await f.controller.update({active: true, version: 1});
	const tree = parseHierarchySnapshot(events[0]);
	expect(tree?.nodes.map(node => node.name)).toEqual(['Card', 'RCTView']);
	expect(tree?.nodes[1].parentId).toBe(tree?.nodes[0].id);
	expect(tree?.props).toBeUndefined();
	const calls = f.roots.mock.calls.length;
	await f.controller.update({active: false, version: 2});
	await f.controller.update({active: false, version: 2});
	expect(f.roots).toHaveBeenCalledTimes(calls);
});

it('returns only the selected props as bounded snapshots without running getters', async () => {
	const f = fixture();
	const id = f.controller.getID(f.card);
	const events = await f.controller.update({active: true, version: 1, selectedId: id});
	const tree = parseHierarchySnapshot(events[0]);
	expect(tree?.selectedId).toBe(id);
	expect(tree?.props?.entries?.find(entry => entry.key === 'title')?.value.preview).toBe('Hello');
	expect(tree?.props?.entries?.find(entry => entry.key === 'secret')?.value.type).toBe('accessor');
	expect(f.getter).not.toHaveBeenCalled();
	const alternate = {...f.card, alternate: f.card};
	expect(f.controller.getID(alternate)).toBe(id);
});

it('measures a component host on hover without recollecting the tree and clears on deactivation', async () => {
	const f = fixture();
	const id = f.controller.getID(f.card);
	await f.controller.update({active: true, version: 1});
	const events = await f.controller.update({active: true, version: 1, hoveredId: id});
	expect(f.roots).toHaveBeenCalledOnce();
	expect(parseHierarchyHighlight(events[0])).toMatchObject({id, width: 400, height: 800, frame: {x: 10, y: 44, width: 100, height: 50}});
	const cleared = await f.controller.update({active: false, version: 1});
	expect(parseHierarchyHighlight(cleared[0])?.frame).toBeUndefined();
});

it('rejects duplicate/cyclic node IDs and malformed props', () => {
	expect(parseHierarchySnapshot({type: 'hierarchy-snapshot', nodes: [{id: 'a', parentId: 'a', name: 'Card'}]})).toBeUndefined();
	expect(parseHierarchySnapshot({type: 'hierarchy-snapshot', nodes: [{id: 'a', name: 'A'}, {id: 'a', name: 'B'}]})).toBeUndefined();
	expect(parseHierarchySnapshot({type: 'hierarchy-snapshot', nodes: [], props: 'raw props'})).toBeUndefined();
});

it('searches beyond the first 3000 displayed components instead of filtering only the initial snapshot', async () => {
	const f = fixture();
	interface Node {tag: number; type: {name: string}; memoizedProps: object; child: null; sibling: Node | null;}
	const nodes: Node[] = Array.from({length: 3101}, (_, index) => ({tag: 0, type: {name: index === 3100 ? 'DeepMatch' : 'Wrapper'}, memoizedProps: {}, child: null, sibling: null}));
	for (let i = 0; i < nodes.length - 1; i++) {nodes[i].sibling = nodes[i + 1];}
	f.root.current.child = nodes[0] as unknown as typeof f.card;
	const initial = parseHierarchySnapshot((await f.controller.update({active: true, version: 1}))[0]);
	expect(initial?.nodes).toHaveLength(3000);
	expect(initial?.truncated).toBe(true);
	const searched = parseHierarchySnapshot((await f.controller.update({active: true, version: 2, query: 'DeepMatch'}))[0]);
	expect(searched?.nodes.map(node => node.name)).toEqual(['DeepMatch']);
	expect(searched?.truncated).toBe(false);
});
