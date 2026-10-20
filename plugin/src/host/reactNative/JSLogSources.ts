import * as path from 'node:path';
import {inspectorStackFrames, localInspectorSource} from './inspectorSource';
import type {JSLog} from '../../shared/jsConsole';

type Location = Pick<JSLog, 'location' | 'source'>;
export class JSLogSources {
	private readonly cache = new Map<string, Promise<Location>>();
	private active = 0;
	constructor(private readonly root: string, private readonly port: number) {}
	async resolve(records: Omit<JSLog, 'id'>[]): Promise<Omit<JSLog, 'id'>[]> {
		return Promise.all(records.map(async ({stack, ...record}) => {
			if (!stack) {return record;}
			const frames = inspectorStackFrames(stack);
			if (!frames.length) {return record;}
			const key = JSON.stringify(frames.slice(0, 5));
			let pending = this.cache.get(key);
			if (!pending && this.active < 4) {
				this.active++;
				pending = this.symbolicate(frames).finally(() => {this.active--;});
				if (this.cache.size >= 256) {this.cache.delete(this.cache.keys().next().value!);}
				this.cache.set(key, pending);
			}
			return {...record, ...(pending ? await pending : {})};
		}));
	}
	private async symbolicate(stack: ReturnType<typeof inspectorStackFrames>): Promise<Location> {
		try {
			const response = await fetch(`http://127.0.0.1:${this.port}/symbolicate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({stack}), signal: AbortSignal.timeout(2000)});
			if (!response.ok) {return {};}
			const result = await response.json() as {stack?: Array<{file?: string; lineNumber?: number; column?: number}>};
			// Use the actual caller, not a later app frame that merely invoked a library.
			const frame = result.stack?.find(frame => frame.file && !frame.file.includes('jsConsole.js'));
			if (!frame?.file || !Number.isSafeInteger(frame.lineNumber) || frame.lineNumber! < 1) {return {};}
			const location = `${path.basename(frame.file)}:${frame.lineNumber}`;
			if (frame.file.split(/[\\/]/).includes('node_modules')) {return {location};}
			const source = await localInspectorSource(this.root, {fileName: frame.file, lineNumber: frame.lineNumber!, columnNumber: Number.isSafeInteger(frame.column) ? Math.max(1, frame.column! + 1) : 1});
			return {location, ...(source ? {source} : {})};
		} catch {return {};}
	}
}
