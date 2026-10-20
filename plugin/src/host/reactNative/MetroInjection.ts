import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class MetroInjection {
	private constructor(readonly directory: string, readonly sessionFile: string) {}
	static async prepare(storagePath: string, root: string, runtimePath: string, controlURL: string): Promise<MetroInjection> {
		await fs.mkdir(storagePath, {recursive: true});
		const directory = await fs.realpath(await fs.mkdtemp(path.join(storagePath, 'metro-')));
		const injection = new MetroInjection(directory, path.join(directory, 'session.json'));
		try {
			const adapter = path.join(directory, 'runtime.js');
			const runtime = await fs.readFile(runtimePath, 'utf8');
			await fs.writeFile(adapter, `${runtime}\nif (__DEV__) { try { module.exports.startScan(${JSON.stringify(controlURL)}); } catch (error) { console.warn('[Valdroid] Runtime initialization failed', error); } }\n`);
			await fs.writeFile(injection.sessionFile, JSON.stringify({root: await fs.realpath(root), runtimePath: adapter, controlURL}), {mode: 0o600});
			return injection;
		} catch (error) {await injection.dispose(); throw error;}
	}
	async dispose(): Promise<void> {await fs.rm(this.directory, {recursive: true, force: true});}
}
