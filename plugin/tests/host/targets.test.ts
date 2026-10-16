// @vitest-environment node
import type * as vscode from 'vscode';
import { beforeEach, expect, it, vi } from 'vitest';
import { listTargets } from '../../src/host/adb/targets';

const mocks = vi.hoisted(() => ({run: vi.fn()}));
vi.mock('../../src/host/session/process', () => ({runFile: mocks.run}));
const output = {appendLine: vi.fn()} as unknown as vscode.OutputChannel;
beforeEach(() => {mocks.run.mockReset();});

it('matches running emulator identities and deduplicates AVDs and serials', async () => {
	mocks.run.mockImplementation(async (_file, args: string[]) => {
		if (args[0] === '-list-avds') {return 'Medium_Phone_API_36\nOther_Phone\nOther_Phone\n';}
		if (args[0] === 'devices') {return 'List of devices attached\nemulator-5554\tdevice\nemulator-5554\tdevice\nphysical\tdevice\noffline\toffline\n';}
		return 'Medium_Phone_API_36\nOK\n';
	});
	expect(await listTargets('emulator', 'adb', output)).toEqual([
		{label: 'Medium_Phone_API_36 (emulator-5554)', value: 'device:emulator-5554', avdName: 'Medium_Phone_API_36'},
		{label: 'physical', value: 'device:physical', avdName: undefined},
		{label: 'Other_Phone', value: 'avd:Other_Phone', avdName: 'Other_Phone'},
	]);
	expect(mocks.run).not.toHaveBeenCalledWith('adb', ['-s', 'physical', 'emu', 'avd', 'name']);
});

it('keeps startup options when the running emulator identity is unavailable', async () => {
	mocks.run.mockImplementation(async (_file, args: string[]) => {
		if (args[0] === '-list-avds') {return 'Phone\n';}
		if (args[0] === 'devices') {return 'List of devices attached\nemulator-5554\tdevice\n';}
		throw new Error('Emulator console unavailable');
	});
	const targets = await listTargets('emulator', 'adb', output);
	expect(targets.map(target => target.value)).toEqual(['device:emulator-5554', 'avd:Phone']);
});
