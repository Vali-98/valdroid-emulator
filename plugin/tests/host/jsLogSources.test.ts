// @vitest-environment node
import {expect, it, vi} from 'vitest';
import {JSLogSources} from '../../src/host/reactNative/JSLogSources';
import {localInspectorSource} from '../../src/host/reactNative/inspectorSource';
import {parseJSLogs} from '../../src/shared/jsConsole';
vi.mock('../../src/host/reactNative/inspectorSource', async original => ({...await original<typeof import('../../src/host/reactNative/inspectorSource')>(), localInspectorSource: vi.fn(async (_root, source) => source)}));
const record = {level: 'log' as const, time: 1, args: [], stack: 'caller@http://10.0.2.2:8081/index.bundle:12:4'};
it('symbolicates to owned Metro, caches call sites, and links only verified source', async () => {
	const fetcher = vi.fn(async (_url: string) => ({ok: true, json: async () => ({stack: [{file: '/project/app.tsx', lineNumber: 8, column: 2}]})}));
	vi.stubGlobal('fetch', fetcher);
	const resolver = new JSLogSources('/project', 8081);
	expect(await resolver.resolve([record])).toEqual([{level: 'log', time: 1, args: [], location: 'app.tsx:8', source: {fileName: '/project/app.tsx', lineNumber: 8, columnNumber: 3}}]);
	await resolver.resolve([record]); expect(fetcher).toHaveBeenCalledTimes(1);
	expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:8081/symbolicate');
});
it('keeps library locations as plain text and does not substitute later app frames', async () => {
	vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => ({stack: [{file: '/project/node_modules/library/index.js', lineNumber: 9}, {file: '/project/app.tsx', lineNumber: 10}]})})));
	expect(await new JSLogSources('/project', 8081).resolve([record])).toEqual([{level: 'log', time: 1, args: [], location: 'index.js:9'}]);
});
it('keeps log text when source resolution fails and strips app-supplied clickable sources', async () => {
	vi.stubGlobal('fetch', vi.fn(async () => {throw new Error('offline');}));
	expect(await new JSLogSources('/project', 8081).resolve([record])).toEqual([{level: 'log', time: 1, args: []}]);
	expect(parseJSLogs({type: 'js-logs', records: [{...record, source: {fileName: '/etc/passwd'}}]})?.[0].source).toBeUndefined();
	expect(localInspectorSource).toBeDefined();
});
