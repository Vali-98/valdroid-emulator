export interface InspectorRequest {id: number; x: number; y: number; select?: boolean;}
export interface InspectorSource {fileName: string; lineNumber: number; columnNumber: number;}
export interface InspectorElement {name: string; source?: InspectorSource; stack?: string;}
export interface InspectorResult {
	type: 'inspector-result'; id: number; width: number; height: number;
	frame?: {x: number; y: number; width: number; height: number};
	elements: InspectorElement[]; error?: string; resolved?: boolean;
}

export function parseInspectorResult(value: unknown): InspectorResult | undefined {
	if (!value || typeof value !== 'object') {return;}
	const data = value as InspectorResult;
	if (data.type !== 'inspector-result' || !Number.isSafeInteger(data.id) || data.id < 1 ||
		![data.width, data.height].every(n => Number.isFinite(n) && n > 0 && n <= 20000) ||
		!Array.isArray(data.elements) || data.elements.length > 12 ||
		(data.error !== undefined && (typeof data.error !== 'string' || data.error.length > 500))) {return;}
	if (data.frame && (![data.frame.x, data.frame.y, data.frame.width, data.frame.height].every(Number.isFinite) || data.frame.width <= 0 || data.frame.height <= 0)) {return;}
	if (!data.elements.every(element => element && typeof element.name === 'string' && element.name.length <= 200 &&
		(element.stack === undefined || typeof element.stack === 'string' && element.stack.length <= 16000) &&
		(!element.source || typeof element.source.fileName === 'string' && element.source.fileName.length <= 4096 &&
		Number.isSafeInteger(element.source.lineNumber) && element.source.lineNumber > 0 &&
		Number.isSafeInteger(element.source.columnNumber) && element.source.columnNumber >= 0))) {return;}
	return data;
}
