// @vitest-environment node
import {afterEach, expect, it} from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {createRequire} from 'node:module';
import {readAndroidArtifact} from '../../src/host/reactNative/AndroidArtifact';

const {hashAPK, resolveArtifact} = createRequire(import.meta.url)('../../src/runtime/expoLifecycle.cjs');
const directories: string[] = [];
afterEach(async () => {await Promise.all(directories.splice(0).map(dir => fs.rm(dir, {recursive: true, force: true})));});
async function fixture() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'valdroid-artifact-'));
	directories.push(dir);
	return fs.realpath(dir);
}
it('selects a standalone APK by Gradle metadata, preferring universal over ABI output', async () => {
	const dir = await fixture();
	await fs.writeFile(path.join(dir, 'app.apk'), 'apk');
	await fs.writeFile(path.join(dir, 'output-metadata.json'), JSON.stringify({applicationId: 'com.example.dev', variantName: 'debug', elements: [
		{outputFile: 'arm.apk', filters: [{filterType: 'ABI', value: 'arm64-v8a'}]},
		{outputFile: 'app.apk', filters: []},
	]}));
	expect(await resolveArtifact(dir, 'x86_64')).toEqual({file: path.join(dir, 'app.apk'), applicationId: 'com.example.dev'});
});
it('refuses ambiguous outputs and directory escapes', async () => {
	const dir = await fixture();
	const metadata = {applicationId: 'com.example', variantName: 'debug', elements: [{outputFile: 'one.apk', filters: []}, {outputFile: 'two.apk', filters: []}]};
	await fs.writeFile(path.join(dir, 'output-metadata.json'), JSON.stringify(metadata));
	await expect(resolveArtifact(dir, 'x86_64')).rejects.toThrow('one compatible');
	metadata.elements = [{outputFile: '../outside.apk', filters: []}];
	await fs.writeFile(path.join(dir, 'output-metadata.json'), JSON.stringify(metadata));
	await expect(resolveArtifact(dir, 'x86_64')).rejects.toThrow('Unsafe');
});
it('validates cached APK contents and project/device identity before installation', async () => {
	const dir = await fixture();
	const source = path.join(dir, 'source.apk');
	await fs.writeFile(source, 'test apk');
	const sha256 = await hashAPK(source);
	const apkPath = path.join(dir, `artifact-${sha256}.apk`);
	await fs.rename(source, apkPath);
	const stateFile = path.join(dir, 'build.json');
	const state = {root: dir, serial: 'emulator-5554', port: 8081, apkPath, sha256, applicationId: 'com.example.dev', launchActivity: '.MainActivity', variant: 'debug'};
	await fs.writeFile(stateFile, JSON.stringify(state));
	expect(await readAndroidArtifact(stateFile, dir, state.serial, state.port)).toEqual(state);
	await expect(readAndroidArtifact(stateFile, dir, 'another-device', state.port)).rejects.toThrow('does not match');
	await fs.writeFile(apkPath, 'modified apk');
	await expect(readAndroidArtifact(stateFile, dir, state.serial, state.port)).rejects.toThrow('changed');
});
