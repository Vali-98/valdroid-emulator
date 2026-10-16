// @vitest-environment node
import { expect, it } from 'vitest';
import { resolveAndroidTools } from '../../src/host/adb/toolPaths';

const unix = {platform: 'linux', home: '/home/test', variables: {}, exists: () => false};

it('uses configured SDK paths without requiring PATH or environment variables', () => {
	expect(resolveAndroidTools({sdkPath: '/custom/Android SDK'}, unix)).toEqual({
		adbPath: '/custom/Android SDK/platform-tools/adb', emulatorPath: '/custom/Android SDK/emulator/emulator',
	});
});

it('gives executable overrides precedence and expands the home directory', () => {
	expect(resolveAndroidTools({sdkPath: '~/sdk', adbPath: ' ~/tools/custom-adb '}, unix)).toEqual({
		adbPath: '/home/test/tools/custom-adb', emulatorPath: '/home/test/sdk/emulator/emulator',
	});
});

it('uses Windows executable names and separators', () => {
	expect(resolveAndroidTools({sdkPath: 'C:\\Android SDK'}, {...unix, platform: 'win32', home: 'C:\\Users\\test'})).toEqual({
		adbPath: 'C:\\Android SDK\\platform-tools\\adb.exe', emulatorPath: 'C:\\Android SDK\\emulator\\emulator.exe',
	});
});

it('skips unavailable environment candidates before trying the next SDK', () => {
	expect(resolveAndroidTools({}, {...unix, variables: {ANDROID_HOME: '/missing', ANDROID_SDK_ROOT: '/sdk'}, exists: file => file.startsWith('/sdk/')})).toEqual({
		adbPath: '/sdk/platform-tools/adb', emulatorPath: '/sdk/emulator/emulator',
	});
});

it.each([
	['darwin', '/home/test/Library/Android/sdk'],
	['linux', '/home/test/Android/Sdk'],
])('discovers a usual %s SDK installation without environment variables', (platform, sdk) => {
	expect(resolveAndroidTools({}, {...unix, platform, exists: file => file.startsWith(sdk + '/')})).toEqual({
		adbPath: `${sdk}/platform-tools/adb`, emulatorPath: `${sdk}/emulator/emulator`,
	});
});

it('falls back to PATH and preserves an explicit command override', () => {
	expect(resolveAndroidTools({}, unix)).toEqual({adbPath: 'adb', emulatorPath: 'emulator'});
	expect(resolveAndroidTools({adbPath: 'my-adb'}, unix).adbPath).toBe('my-adb');
});
