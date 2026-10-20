import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import * as path from 'node:path';

export interface AndroidArtifact {root: string; serial: string; port: number; apkPath: string; sha256: string; applicationId: string; launchActivity: string; variant: 'debug';}
export async function readAndroidArtifact(stateFile: string, root: string, serial: string, port: number): Promise<AndroidArtifact> {
	const state = JSON.parse(await fs.readFile(stateFile, 'utf8')) as AndroidArtifact;
	if (state.root !== await fs.realpath(root) || state.serial !== serial || state.port !== port || state.variant !== 'debug' ||
		!/^([A-Za-z]\w*\.)+[A-Za-z]\w*$/.test(state.applicationId ?? '') || !/^[a-f0-9]{64}$/.test(state.sha256 ?? '') || typeof state.apkPath !== 'string') {throw new Error('Build artifact does not match this project/device session.');}
	const apk = await fs.realpath(state.apkPath);
	if (path.dirname(apk) !== await fs.realpath(path.dirname(stateFile)) || path.basename(apk) !== `artifact-${state.sha256}.apk`) {throw new Error('APK is not the session-owned build artifact.');}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(apk)) {hash.update(chunk);}
	if (hash.digest('hex') !== state.sha256) {throw new Error('The cached APK changed. Build again before installing.');}
	return {...state, apkPath: apk};
}
