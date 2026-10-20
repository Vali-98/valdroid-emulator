// @vitest-environment node
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {createRequire} from 'node:module';
import * as vm from 'node:vm';
import {expect, it} from 'vitest';
import {MetroInjection} from '../../src/host/reactNative/MetroInjection';

const expoProject = process.env.VALDROID_EXPO_TEST_PROJECT;
// Optional real-Metro test: reuse installed SDK dependencies, never the app's
// config or source. Every generated test file lives in a fresh temporary folder.
it.skipIf(!expoProject)('bundles the injected adapter with real Expo/Metro and leaves release output untouched', async () => {
	const require = createRequire(import.meta.url);
	const fromProject = createRequire(path.join(expoProject!, 'package.json'));
	const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'valdroid-real-metro-')));
	const root = path.join(directory, 'app');
	const storage = path.join(directory, 'storage');
	await fs.mkdir(root); await fs.mkdir(storage);
	try {
		await fs.symlink(path.join(expoProject!, 'node_modules'), path.join(root, 'node_modules'), 'junction');
		await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({name: 'valdroid-metro-fixture', main: 'index.js'}));
		await fs.writeFile(path.join(root, 'index.js'), 'import "./before";\nglobalThis.__VALDROID_TEST_ENTRY__ = true;\n');
		await fs.writeFile(path.join(root, 'before.js'), 'globalThis.events?.push("import");\n');
		await fs.writeFile(path.join(root, 'babel.config.cjs'), `module.exports = {presets: [${JSON.stringify(fromProject.resolve('babel-preset-expo'))}]};`);
		const injection = await MetroInjection.prepare(storage, root, path.resolve('dist/react-scan-runtime.js'), 'http://127.0.0.1:1234/valdroid-smoke-token');
		const sessionFile = injection.sessionFile;
		const {runtimePath} = JSON.parse(await fs.readFile(sessionFile, 'utf8')) as {runtimePath: string};
		// Exercise the packaged preload's loader hook and generated worker wrapper,
		// not just the pure config wrapper used in the unit tests.
		const {installMetroIntegration} = require(path.resolve('dist/metroIntegration.cjs'));
		installMetroIntegration(sessionFile, path.join(root, 'cli.js'));
		const expoConfig = fromProject('@expo/metro-config');
		const config = typeof expoConfig.loadUserConfig === 'function'
			? await expoConfig.loadUserConfig({projectRoot: root, serverRoot: root})
			: await fromProject('metro-config').loadConfig({cwd: root}, expoConfig.getDefaultConfig(root));
		config.watchFolders = [...new Set([...config.watchFolders, await fs.realpath(path.join(root, 'node_modules'))])];
		config.resolver.useWatchman = false; config.maxWorkers = 1;
		config.reporter = {update() {}};
		let Metro;
		try {Metro = fromProject('@expo/metro/metro');} catch {Metro = fromProject('metro');}
		// Recent Expo CLI installs its packed-map encoder before constructing Metro.
		// Mirror that initialization when invoking Metro directly in this fixture.
		try {fromProject('@expo/metro-config/build/serializer/sourceMap').patchMetroSourceMapStringForPackedMaps?.();} catch {/* Older SDKs use Metro's default maps. */}
		const dev = await Metro.runBuild(config, {entry: 'index.js', platform: 'android', dev: true, minify: false});
		expect(dev.code).toContain('valdroid-smoke-token');
		expect(dev.code).toContain('__VALDROID_TEST_ENTRY__');
		const {TraceMap, originalPositionFor} = fromProject('@jridgewell/trace-mapping');
		const prefix = dev.code.slice(0, dev.code.indexOf('globalThis.__VALDROID_TEST_ENTRY__'));
		const lines = prefix.split('\n');
		const source = originalPositionFor(new TraceMap(dev.map), {line: lines.length, column: lines.at(-1)!.length});
		expect(source.source).toBe(path.join(root, 'index.js'));
		expect(source.line).toBe(2);
		const release = await Metro.runBuild(config, {entry: 'index.js', platform: 'android', dev: false, minify: false});
		expect(release.code).not.toContain('valdroid-smoke-token');
		// Verify the hook starts before static app imports, including Expo's later
		// import-hoisting pass (important with React Compiler enabled).
		await fs.writeFile(runtimePath, 'exports.startScan = () => globalThis.events.push("injected"); if (__DEV__) exports.startScan();');
		for (const customTransformOptions of [{}, {reactCompiler: 'true'}]) {
			const ordering = await Metro.runBuild(config, {entry: 'index.js', platform: 'android', dev: true, minify: false, customTransformOptions});
			const sandbox = {events: [] as string[], console, setTimeout, clearTimeout};
			vm.runInNewContext(ordering.code, sandbox);
			expect(sandbox.events).toEqual(['injected', 'import']);
		}
		expect(await fs.readdir(root)).toEqual(['babel.config.cjs', 'before.js', 'index.js', 'node_modules', 'package.json']);
	} finally {await fs.rm(directory, {recursive: true, force: true});}
}, 120000);
