import { parse } from 'shell-quote';

export function adbArguments(command: string): string[] {
	const source = command.trim().replace(/^adb\s+/, '');
	if (!source || source.length > 8192 || source.includes('\0')) { throw new Error('Invalid ADB command'); }
	// Remote shell syntax belongs to Android; never execute a host shell.
	if (/^shell\s+\S/.test(source)) { return ['shell', source.slice(5).trim()]; }
	const words = parse(source, key => `$${key}`);
	if (!words.length || words.some(word => typeof word !== 'string') || String(words[0]).startsWith('-') || words[0] === 'shell') {
		throw new Error('Use an ADB command, or shell followed by a remote command');
	}
	return words as string[];
}
