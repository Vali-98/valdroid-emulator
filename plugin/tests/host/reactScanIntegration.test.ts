import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { ReactScanIntegration } from '../../src/host/reactNative/ReactScanIntegration';

const directories: string[] = [];

afterEach(async () => {await Promise.all(directories.splice(0).map(directory => fs.rm(directory, {recursive: true, force: true})));});

async function fixture(packageJSON: object): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'valdroid-react-scan-'));
	directories.push(directory);
	await fs.writeFile(path.join(directory, 'package.json'), `${JSON.stringify(packageJSON, undefined, 2)}\n`);
	return directory;
}

describe('ReactScanIntegration', () => {
	it('creates a development-only entry and restores the Expo entry on disable', async () => {
		const root = await fixture({name: 'demo', dependencies: {expo: '~55.0.0', 'react-scan': '^0.0.0'}});
		const project = await ReactScanIntegration.inspect(root);
		expect(project.entryModule).toBe('expo/AppEntry');
		await ReactScanIntegration.enable(project);
		const enabled = await ReactScanIntegration.inspect(root);
		expect(enabled.enabled).toBe(true);
		expect(await fs.readFile(path.join(root, '.valdroid', 'react-scan-entry.js'), 'utf8')).toContain('require("expo/AppEntry")');
		await ReactScanIntegration.disable(enabled);
		const packageJSON = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {main?: string};
		expect(packageJSON.main).toBeUndefined();
		expect(await fs.stat(path.join(root, '.valdroid')).catch(() => undefined)).toBeUndefined();
	});

	it('preserves an Expo Router entry module', async () => {
		const root = await fixture({name: 'demo', main: 'expo-router/entry', dependencies: {expo: '~55.0.0', 'react-scan': '^0.0.0'}});
		await ReactScanIntegration.enable(await ReactScanIntegration.inspect(root));
		const entry = await fs.readFile(path.join(root, '.valdroid', 'react-scan-entry.js'), 'utf8');
		expect(entry).toContain('require("expo-router/entry")');
		await ReactScanIntegration.disable(await ReactScanIntegration.inspect(root));
		const packageJSON = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {main?: string};
		expect(packageJSON.main).toBe('expo-router/entry');
	});

	it('resolves a project-local custom entry from the generated directory', async () => {
		const root = await fixture({name: 'demo', main: 'index.js', dependencies: {expo: '~55.0.0', 'react-scan': '^0.0.0'}});
		await ReactScanIntegration.enable(await ReactScanIntegration.inspect(root));
		const entry = await fs.readFile(path.join(root, '.valdroid', 'react-scan-entry.js'), 'utf8');
		expect(entry).toContain('require("../index.js")');
	});

	it('supplies the bundled runtime without a project dependency', async () => {
		const root = await fixture({name: 'demo', dependencies: {expo: '~55.0.0'}});
		const runtime = path.join(root, 'runtime.js');
		await fs.writeFile(runtime, 'module.exports = {};');
		await ReactScanIntegration.enable(await ReactScanIntegration.inspect(root), runtime, 'http://127.0.0.1:12345/token');
		expect(await fs.readFile(path.join(root, '.valdroid', 'react-scan-runtime.js'), 'utf8')).toBe('module.exports = {};');
		expect(await fs.readFile(path.join(root, '.valdroid', 'react-scan-entry.js'), 'utf8')).toContain("require('./react-scan-runtime').startScan");
	});

	it('starts the supplied native adapter before loading the app', async () => {
		const root = await fixture({dependencies: {expo: '*'}});
		const runtime = path.join(root, 'runtime.js');
		await fs.writeFile(runtime, 'unused');
		await ReactScanIntegration.enable(await ReactScanIntegration.inspect(root), runtime, 'http://localhost/control');
		const source = await fs.readFile(path.join(root, '.valdroid', 'react-scan-entry.js'), 'utf8');
		const calls: string[] = [];
		vm.runInNewContext(source, {
			__DEV__: true, console,
			require: (module: string) => module === './react-scan-runtime' ? {startScan: (url: string) => calls.push(url)} : calls.push(module),
		});
		expect(calls).toEqual(['http://localhost/control', 'expo/AppEntry']);
	});
});
