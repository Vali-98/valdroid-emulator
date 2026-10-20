import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {InspectorElement, InspectorSource} from '../../shared/inspector';

export async function localInspectorSource(root: string, source?: InspectorSource): Promise<InspectorSource | undefined> {
	if (!source || /^(https?:|file:|[a-z]+:\/\/)/i.test(source.fileName)) {return;}
	const file = await fs.realpath(path.resolve(root, source.fileName)).catch(() => undefined);
	const project = await fs.realpath(root);
	if (!file || path.relative(project, file).startsWith(`..${path.sep}`) || path.relative(project, file) === '..' || path.isAbsolute(path.relative(project, file)) || !/\.[cm]?[jt]sx?$/.test(file)) {return;}
	return {...source, fileName: file};
}

export function inspectorStackFrames(stack: string) {
	return stack.split('\n').slice(0, 30).flatMap(line => {
		// Hermes "name@url:line:column" and V8 "at name (url:line:column)".
		const match = line.match(/(?:@|\(|\s)(https?:\/\/.+):(\d+):(\d+)\)?$/);
		return match ? [{file: match[1], lineNumber: Number(match[2]), column: Math.max(0, Number(match[3]) - 1), methodName: '<unknown>'}] : [];
	});
}

export async function resolveInspectorElements(root: string, port: number | undefined, elements: InspectorElement[]): Promise<InspectorElement[]> {
	return Promise.all(elements.map(async element => {
		let source = await localInspectorSource(root, element.source);
		if (!source && port && element.stack) {
			const stack = inspectorStackFrames(element.stack);
			if (stack.length) {
				try {
					// Always contact our owned Metro, never a URL supplied by the app/webview.
					const response = await fetch(`http://127.0.0.1:${port}/symbolicate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({stack}), signal: AbortSignal.timeout(2500)});
					if (response.ok) {
						const data = await response.json() as {stack?: Array<{file?: string; lineNumber?: number; column?: number}>};
						for (const frame of (data.stack ?? []).slice(0, 30)) {
							if (!frame.file || frame.file.includes('node_modules') || !Number.isSafeInteger(frame.lineNumber) || frame.lineNumber! < 1) {continue;}
							source = await localInspectorSource(root, {fileName: frame.file, lineNumber: frame.lineNumber!, columnNumber: Math.max(1, (frame.column ?? 0) + 1)});
							if (source) {break;}
						}
					}
				} catch {/* Keep the hierarchy usable when source maps aren't available. */}
			}
		}
		return {name: element.name, ...(element.fiberId ? {fiberId: element.fiberId} : {}), ...(source ? {source} : {})};
	}));
}
