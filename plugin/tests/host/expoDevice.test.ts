import { expect, it, vi } from 'vitest';
import { runFile } from '../../src/host/session/process';
import { resolveExpoDeviceName } from '../../src/host/reactNative/expoDevice';

vi.mock('../../src/host/session/process', () => ({runFile: vi.fn()}));

it('maps an emulator serial to the AVD name Expo expects', async () => {
	vi.mocked(runFile).mockResolvedValue('Pixel_9_API_35\r\nOK\r\n');
	expect(await resolveExpoDeviceName('/sdk/adb', 'emulator-5554')).toBe('Pixel_9_API_35');
	expect(runFile).toHaveBeenCalledWith('/sdk/adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']);
});

it('uses the attached physical device model from adb devices -l', async () => {
	vi.mocked(runFile).mockResolvedValue('List of devices attached\nABC device product:pixel model:Pixel_8 device:shiba\n');
	expect(await resolveExpoDeviceName('adb', 'ABC')).toBe('Pixel_8');
});

it('does not fall back to the serial when the AVD name is unavailable', async () => {
	vi.mocked(runFile).mockResolvedValue('OK\n');
	await expect(resolveExpoDeviceName('adb', 'emulator-5554')).rejects.toThrow('Could not resolve');
});
