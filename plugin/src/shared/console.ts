export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
export interface ConsoleRecord {
	id: number;
	kind: 'log' | 'command' | 'output' | 'error' | 'notice';
	time: string;
	level: LogLevel;
	pid?: number;
	tag?: string;
	packageName?: string;
	text: string;
}
export interface ConsoleState {
	serial?: string;
	streaming: boolean;
	busy: boolean;
	packages: string[];
	processes: Record<string, string>;
}
export type ConsoleRequest =
	| {type: 'js-open-source'; id: number}
	| {type: 'hierarchy-search'; query: string}
	| {type: 'hierarchy-active'; active: boolean}
	| {type: 'hierarchy-select' | 'hierarchy-hover'; id?: string}
	| {type: 'hierarchy-refresh'}
	| {type: 'js-clear'}
	| {type: 'metro-clear'}
	| { type: 'console-ready' | 'console-clear' | 'console-toggle' | 'console-cancel' | 'console-copy'; text?: string }
	| { type: 'console-command'; command: string };
export type ConsoleMessage =
	| import('./hierarchy').HierarchySnapshot
	| {type: 'hierarchy-focus'; id: string}
	| {type: 'js-snapshot' | 'js-records'; records: import('./jsConsole').JSLog[]; oldestID?: number}
	| import('./protocol').ProjectInfo
	| {type: 'metro-snapshot'; text: string; focus?: boolean}
	| {type: 'metro-output'; text: string}
	| { type: 'console-snapshot'; state: ConsoleState; records: ConsoleRecord[] }
	| { type: 'console-state'; state: ConsoleState }
	| { type: 'console-records'; records: ConsoleRecord[] };
export const consoleLimit = 5000;
export const metroLogLimit = 2 * 1024 * 1024;
export const levelRank: Record<LogLevel, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };

export function parseLogcat(line: string, id: number, processes: Record<string, string>): ConsoleRecord {
	const match = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+\d+\s+([VDIWEFA])\s+(.+?)\s*:\s?(.*)$/.exec(line);
	if (!match) { return { id, kind: 'notice', time: '', level: 'I', text: line }; }
	const pid = Number(match[2]);
	return { id, kind: 'log', time: match[1], pid, level: match[3] === 'A' ? 'F' : match[3] as LogLevel, tag: match[4], packageName: processes[pid], text: match[5] };
}

export function filterRecords(records: ConsoleRecord[], level: LogLevel, packageName: string, search: string, processes: Record<string, string>): ConsoleRecord[] {
	const needle = search.toLocaleLowerCase();
	return records.filter(record => {
		if (record.kind === 'log' && (levelRank[record.level] < levelRank[level] || (packageName && (record.packageName ?? processes[record.pid ?? '']) !== packageName))) { return false; }
		return !needle || [record.text, record.tag, record.packageName ?? processes[record.pid ?? ''], record.pid, record.time].join(' ').toLocaleLowerCase().includes(needle);
	});
}

export function parseProcesses(text: string): Record<string, string> {
	const processes: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
		if (match) { processes[match[1]] = match[2].split(':')[0]; }
	}
	return processes;
}
