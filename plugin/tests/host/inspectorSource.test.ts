import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {inspectorStackFrames, localInspectorSource, resolveInspectorElements} from '../../src/host/reactNative/inspectorSource';
import {parseInspectorResult} from '../../src/shared/inspector';

const directories: string[] = [];
afterEach(async () => {await Promise.all(directories.splice(0).map(dir => fs.rm(dir, {recursive: true, force: true})));});
async function fixture() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'valdroid-inspector-'));
	directories.push(dir);
	await fs.mkdir(path.join(dir, 'app'));
	await fs.writeFile(path.join(dir, 'app', 'index.tsx'), 'export default function Screen() {}');
	return fs.realpath(dir);
}
it('parses Hermes and V8 bundle frames', () => {
	expect(inspectorStackFrames('Error\nCard@http://10.0.2.2:8081/index.bundle?dev=true:40:8\n    at Screen (http://localhost:8081/index.bundle:50:9)')).toEqual([
		{file: 'http://10.0.2.2:8081/index.bundle?dev=true', lineNumber: 40, column: 7, methodName: '<unknown>'},
		{file: 'http://localhost:8081/index.bundle', lineNumber: 50, column: 8, methodName: '<unknown>'},
	]);
});
it('only resolves real source files inside the project, including symlink protection', async () => {
	const root = await fixture();
	const source = {fileName: 'app/index.tsx', lineNumber: 1, columnNumber: 1};
	expect((await localInspectorSource(root, source))?.fileName).toBe(path.join(root, 'app/index.tsx'));
	expect(await localInspectorSource(root, {...source, fileName: 'http://evil/app.tsx'})).toBeUndefined();
	const outside = await fixture();
	await fs.symlink(path.join(outside, 'app/index.tsx'), path.join(root, 'escape.tsx'));
	expect(await localInspectorSource(root, {...source, fileName: 'escape.tsx'})).toBeUndefined();
});
it('symbolicates through owned Metro and strips raw stacks before sending to the webview', async () => {
	const root = await fixture();
	const fetchMock = vi.fn(async (_url: string) => ({ok: true, json: async () => ({stack: [{file: path.join(root, 'app/index.tsx'), lineNumber: 7, column: 2}]})}));
	vi.stubGlobal('fetch', fetchMock);
	const result = await resolveInspectorElements(root, 8082, [{name: 'Card', stack: '    at Screen (http://untrusted/index.bundle:50:9)'}]);
	expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8082/symbolicate');
	expect(result[0]).toEqual({name: 'Card', source: {fileName: path.join(root, 'app/index.tsx'), lineNumber: 7, columnNumber: 3}});
});
it('rejects malformed runtime results', () => {
	expect(parseInspectorResult({type: 'inspector-result', id: 1, width: 400, height: 800, elements: [{name: 'Card', source: {fileName: 'a.tsx', lineNumber: -1}}]})).toBeUndefined();
	expect(parseInspectorResult({type: 'inspector-result', id: 1, width: 400, height: 800, elements: [], frame: {x: 0, y: 0, width: Infinity, height: 10}})).toBeUndefined();
});
