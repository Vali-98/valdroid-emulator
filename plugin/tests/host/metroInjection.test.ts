// @vitest-environment node
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {createRequire} from 'node:module';
import {afterEach, expect, it, vi} from 'vitest';

const require = createRequire(import.meta.url);
// Test the same plain CommonJS functions loaded by Metro and its worker processes.
const {wrapMetroConfig, createTransformer, installMetroIntegration} = require('../../src/runtime/metroIntegration.cjs');
const directories: string[] = [];
afterEach(async () => {await Promise.all(directories.splice(0).map(dir => fs.rm(dir, {recursive: true, force: true})));});
async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'valdroid-metro-test-'));
	directories.push(root);
	const storage = path.join(root, 'storage');
	await fs.mkdir(storage);
	const runtimePath = path.join(storage, 'runtime.js');
	const entryPath = path.join(root, 'index.tsx');
	const originalTransformer = path.join(root, 'original.cjs');
	await fs.writeFile(runtimePath, 'module.exports = {startScan() {}}');
	await fs.writeFile(entryPath, 'original entry');
	await fs.writeFile(originalTransformer, `exports.getCacheKey = () => 'original-key'; exports.transform = args => ({metadata: {keep: true}, ast: {type: 'File', program: {type: 'Program', body: [{type: 'ExpressionStatement', expression: {type: 'NumericLiteral', value: 42}, loc: {start: {line: 1, column: 0}, end: {line: 1, column: 2}}}]}}});`);
	return {root, runtimePath, entryPath, originalTransformer, controlURL: 'http://127.0.0.1:1234/token'};
}

it('keeps custom Metro settings and resolves runtime imports through the app resolver', async () => {
	const f = await fixture();
	const resolveRequest = vi.fn((context: {originModulePath: string}, name: string) => ({type: 'sourceFile', filePath: context.originModulePath + ':' + name}));
	const serializer = {customSerializer: vi.fn()};
	const config = {projectRoot: f.root, watchFolders: ['/shared'], resolver: {resolveRequest, sourceExts: ['tsx']}, serializer, transformer: {babelTransformerPath: f.originalTransformer, custom: true}};
	const wrapped = wrapMetroConfig(config, f, path.resolve('src/runtime/metroIntegration.cjs'));
	expect(config.watchFolders).toEqual(['/shared']);
	expect(wrapped.serializer).toBe(serializer);
	expect(wrapped.resolver.sourceExts).toEqual(['tsx']);
	expect(wrapped.transformer.custom).toBe(true);
	expect(wrapped.watchFolders).toEqual([f.root, '/shared', path.dirname(f.runtimePath)]);
	wrapped.resolver.resolveRequest({originModulePath: f.runtimePath}, 'react-native', 'android');
	expect(resolveRequest).toHaveBeenLastCalledWith({originModulePath: path.join(f.root, 'package.json')}, 'react-native', 'android');
	wrapped.resolver.resolveRequest({originModulePath: f.entryPath}, './Card', 'android');
	expect(resolveRequest).toHaveBeenLastCalledWith({originModulePath: f.entryPath}, './Card', 'android');
	expect(wrapped.resolver.resolveRequest({}, f.runtimePath, 'android')).toEqual({type: 'sourceFile', filePath: f.runtimePath});
});

it('injects before the real Android entry without shifting original AST source locations', async () => {
	const f = await fixture();
	const transformer = createTransformer(f);
	const result = await transformer.transform({filename: 'index.tsx', options: {dev: true, platform: 'android', projectRoot: f.root}});
	expect(result.metadata).toEqual({keep: true});
	expect(result.ast.program.body).toHaveLength(2);
	const injected = result.ast.program.body[0];
	expect(injected.test.name).toBe('__DEV__');
	expect(injected.consequent.body[0].expression.callee.name).toBe('require');
	expect(injected.consequent.body[0].expression.arguments[0].value).toBe(f.runtimePath);
	expect(result.ast.program.body[1].loc.start).toEqual({line: 1, column: 0});
	// The generated worker wrapper can load the integration as a separate Node module.
	const config = wrapMetroConfig({transformer: {babelTransformerPath: f.originalTransformer}}, f, path.resolve('src/runtime/metroIntegration.cjs'));
	expect(typeof require(config.transformer.babelTransformerPath).transform).toBe('function');
});

it('uses the first side-effect import when Metro defers ESM lowering for React Compiler', async () => {
	const f = await fixture();
	const result = await createTransformer(f).transform({filename: f.entryPath, options: {dev: true, platform: 'android', experimentalImportSupport: true}});
	expect(result.ast.program.body[0]).toEqual({type: 'ImportDeclaration', specifiers: [], source: {type: 'StringLiteral', value: f.runtimePath}});
});

it('does not inject release, web, server, or non-entry transforms, and salts caches per session', async () => {
	const f = await fixture();
	const transformer = createTransformer(f);
	for (const options of [{dev: false, platform: 'android'}, {dev: true, platform: 'web'}, {dev: true, platform: 'android', customTransformOptions: {environment: 'react-server'}}]) {
		expect((await transformer.transform({filename: f.entryPath, options})).ast.program.body).toHaveLength(1);
	}
	expect((await transformer.transform({filename: 'other.tsx', options: {dev: true, platform: 'android'}})).ast.program.body).toHaveLength(1);
	expect(transformer.getCacheKey()).not.toBe(createTransformer({...f, controlURL: 'http://localhost/new-session'}).getCacheKey());
});

it('wraps the actual config-loader export after it has loaded the user configuration', async () => {
	const f = await fixture();
	const expoRoot = path.join(f.root, 'node_modules/@expo/metro-config');
	await fs.mkdir(path.join(expoRoot, 'build/config'), {recursive: true});
	await fs.writeFile(path.join(expoRoot, 'package.json'), JSON.stringify({name: '@expo/metro-config', main: 'index.js'}));
	await fs.writeFile(path.join(expoRoot, 'build/config/loadUserConfig.js'), `exports.loadUserConfig = async () => ({projectRoot: ${JSON.stringify(f.root)}, transformer: {babelTransformerPath: ${JSON.stringify(f.originalTransformer)}}, serializer: {userSetting: true}});`);
	const configRoot = path.join(f.root, 'node_modules/@expo/config');
	await fs.mkdir(configRoot, {recursive: true});
	await fs.writeFile(path.join(configRoot, 'paths.js'), `exports.resolveEntryPoint = () => ${JSON.stringify(f.entryPath)};`);
	const sessionFile = path.join(path.dirname(f.runtimePath), 'session.json');
	await fs.writeFile(sessionFile, JSON.stringify(f));
	const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	installMetroIntegration(sessionFile, path.join(f.root, 'cli.js'));
	const config = await require(path.join(expoRoot, 'build/config/loadUserConfig.js')).loadUserConfig();
	expect(config.serializer.userSetting).toBe(true);
	expect(config.transformer.babelTransformerPath).toBe(path.join(path.dirname(f.runtimePath), 'transformer.cjs'));
	expect(stderr).toHaveBeenCalledWith(expect.stringContaining('project files are unchanged'));
});
