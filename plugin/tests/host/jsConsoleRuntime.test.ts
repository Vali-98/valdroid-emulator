// @vitest-environment node
import {buildSync} from 'esbuild';
import * as vm from 'node:vm';
import * as path from 'node:path';
import {expect, it, vi} from 'vitest';
import {parseJSLogs, type JSValue} from '../../src/shared/jsConsole';

function runtime() {
	const code = buildSync({entryPoints: [path.resolve('src/runtime/jsConsole.js')], bundle: true, format: 'cjs', write: false}).outputFiles[0].text;
	let flush: (() => Promise<void>) | undefined;
	const posted: unknown[] = [];
	const original = vi.fn();
	const sandbox = {
		module: {exports: {} as {serializeJSValue: (value: unknown) => JSValue; installJSConsole: (url: string) => void}},
		console: {log: original, info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn()},
		setInterval: (callback: () => Promise<void>) => {flush = callback;}, setTimeout: () => 1, clearTimeout() {},
		fetch: async (_url: string, options: {body: string}) => {posted.push(JSON.parse(options.body));},
	};
	vm.runInNewContext(code, sandbox);
	return {...sandbox.module.exports, sandbox, original, posted, flush: () => flush?.()};
}

it('preserves arrays and nested properties without executing getters, and handles circular references', () => {
	const r = runtime();
	const getter = vi.fn(() => {throw new Error('must not run');});
	const object: Record<string, unknown> = {array: [1, {nested: true}]};
	object.self = object;
	Object.defineProperty(object, 'secret', {get: getter});
	const value = r.serializeJSValue(object);
	expect(getter).not.toHaveBeenCalled();
	expect(value.entries?.find(entry => entry.key === 'array')?.value).toMatchObject({type: 'array', preview: 'Array(2)'});
	expect(value.entries?.find(entry => entry.key === 'secret')?.value.type).toBe('accessor');
	expect(value.entries?.find(entry => entry.key === 'self')?.value.type).toBe('reference');
});

it('captures snapshot values independently of Scan and forwards original console calls only once', async () => {
	const r = runtime();
	r.installJSConsole('http://localhost/bridge');
	r.installJSConsole('http://localhost/bridge');
	const value = {items: [1, 2]};
	r.sandbox.console.log('message', value);
	value.items.push(3);
	await r.flush();
	expect(r.original).toHaveBeenCalledOnce();
	const records = parseJSLogs(r.posted[0]);
	expect(records?.[0].args[1].entries?.[0].value.preview).toBe('Array(2)');
	expect(records?.[0].args[0].preview).toBe('message');
});
