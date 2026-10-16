import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface ToolSettings { sdkPath?: string; adbPath?: string; emulatorPath?: string; }
interface Environment {
	platform: string;
	home: string;
	variables: NodeJS.ProcessEnv;
	exists: (file: string) => boolean;
}

export function resolveAndroidTools(settings: ToolSettings, environment: Environment = {
	platform: process.platform, home: os.homedir(), variables: process.env, exists: fs.existsSync,
}) {
	const paths = environment.platform === 'win32' ? path.win32 : path.posix;
	const expand = (value: string) => value === '~' ? environment.home
		: /^~[/\\]/.test(value) ? paths.join(environment.home, value.slice(2)) : value;
	const explicitSDK = settings.sdkPath?.trim();
	const usualSDK = environment.platform === 'darwin' ? paths.join(environment.home, 'Library', 'Android', 'sdk')
		: environment.platform === 'win32' ? paths.join(environment.variables.LOCALAPPDATA || paths.join(environment.home, 'AppData', 'Local'), 'Android', 'Sdk')
		: paths.join(environment.home, 'Android', 'Sdk');
	const candidates = [explicitSDK, environment.variables.ANDROID_HOME, environment.variables.ANDROID_SDK_ROOT, usualSDK]
		.filter((value): value is string => Boolean(value)).map(expand);
	const executable = (override: string | undefined, folder: string, name: string) => {
		if (override?.trim()) {return expand(override.trim());}
		const binary = environment.platform === 'win32' ? `${name}.exe` : name;
		// A configured SDK is authoritative so a bad setting produces a useful path error.
		if (explicitSDK) {return paths.join(candidates[0], folder, binary);}
		return candidates.map(sdk => paths.join(sdk, folder, binary)).find(environment.exists) ?? binary;
	};
	return {adbPath: executable(settings.adbPath, 'platform-tools', 'adb'), emulatorPath: executable(settings.emulatorPath, 'emulator', 'emulator')};
}
