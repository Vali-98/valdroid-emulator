export interface JSValue {type: string; preview: string; entries?: Array<{key: string; value: JSValue}>; truncated?: boolean;}
export interface JSLog {id: number; level: 'log' | 'info' | 'debug' | 'warn' | 'error'; time: number; args: JSValue[]; stack?: string; location?: string; source?: import('./inspector').InspectorSource;}
export const jsLogLimit = 1000;
export function parseJSLogs(value: unknown): Omit<JSLog, 'id'>[] | undefined {
	if (!value || typeof value !== 'object') {return;}
	const message = value as {type: string; records: Omit<JSLog, 'id'>[]};
	if (message.type !== 'js-logs' || !Array.isArray(message.records) || message.records.length > 20) {return;}
	let nodes = 0;
	const validValue = (item: JSValue, depth: number): boolean => {
		if (++nodes > 12000 || depth > 8 || !item || typeof item !== 'object' || typeof item.type !== 'string' || typeof item.preview !== 'string' || item.preview.length > 10000) {return false;}
		return item.entries === undefined || (Array.isArray(item.entries) && item.entries.length <= 100 && item.entries.every(entry => entry && typeof entry.key === 'string' && entry.key.length <= 1000 && validValue(entry.value, depth + 1)));
	};
	if (!message.records.every(record => record && ['log', 'info', 'debug', 'warn', 'error'].includes(record.level) && Number.isFinite(record.time) && Array.isArray(record.args) && record.args.length <= 20 && record.args.every(arg => validValue(arg, 0)))) {return;}
	return message.records.map(({level, time, args, stack}) => ({level, time, args, ...(typeof stack === 'string' ? {stack: stack.slice(0, 16000)} : {})}));
}
