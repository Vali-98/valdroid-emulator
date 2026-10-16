import { describe, expect, it } from 'vitest';
import { adbArguments } from '../../src/host/adb/adbCommand';
import { filterRecords, parseLogcat, parseProcesses } from '../../src/shared/console';

describe('ADB console commands', () => {
	it('parses quoted host arguments without a host shell', () => {
		expect(adbArguments('adb install "/tmp/My App.apk"')).toEqual(['install', '/tmp/My App.apk']);
		expect(adbArguments('push "a b.txt" /sdcard/Download/')).toEqual(['push', 'a b.txt', '/sdcard/Download/']);
	});
	it('preserves Android shell quoting, variables, and pipes', () => {
		expect(adbArguments('shell echo "$PATH" | head -c 50')).toEqual(['shell', 'echo "$PATH" | head -c 50']);
	});
	it.each(['', 'shell', '-s other-device shell id', 'devices && echo hello', 'devices > /tmp/file', 'devices\0'])('rejects invalid or host shell syntax: %s', value => {
		expect(() => adbArguments(value)).toThrow();
	});
});

describe('log parsing and filtering', () => {
	const processes = parseProcesses(' PID NAME\n 123 dev.example:worker\n 456 system_server\ninvalid\n');
	const info = parseLogcat('10-15 12:34:56.789   123   124 I MyTag   : hello world', 1, processes);
	const error = parseLogcat('10-15 12:34:56.790   456   457 E OtherTag: failed request', 2, processes);
	it('maps multi-process apps and structured logcat fields', () => {
		expect(processes['123']).toBe('dev.example');
		expect(info).toMatchObject({ pid: 123, tag: 'MyTag', level: 'I', text: 'hello world', packageName: 'dev.example' });
	});
	it('keeps buffer markers and malformed lines readable', () => {
		expect(parseLogcat('--------- beginning of main', 3, {})).toMatchObject({ kind: 'notice', text: '--------- beginning of main' });
	});
	it('applies minimum level, package and case-insensitive search together', () => {
		expect(filterRecords([info, error], 'W', '', '', processes)).toEqual([error]);
		expect(filterRecords([info, error], 'V', 'dev.example', 'HELLO', processes)).toEqual([info]);
		expect(filterRecords([info, error], 'V', '', 'othertag', processes)).toEqual([error]);
	});
	it('resolves new process IDs from the latest mapping', () => {
		const record = parseLogcat('10-15 12:34:56.789 789 790 D Worker: ready', 4, {});
		expect(filterRecords([record], 'V', 'dev.new', '', { '789': 'dev.new' })).toEqual([record]);
	});
	it('retains command output when log-level/package filters are active', () => {
		const command = { ...info, kind: 'output' as const, text: 'command output' };
		expect(filterRecords([info, command], 'F', 'other.package', '', processes)).toEqual([command]);
	});
});
