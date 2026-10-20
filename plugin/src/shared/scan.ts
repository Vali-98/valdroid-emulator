export interface ScanOutline {id: number; name: string; count: number; x: number; y: number; width: number; height: number; didCommit: 0 | 1;}
export interface ScanOutlines {type: 'scan-outlines'; width: number; height: number; outlines: ScanOutline[];}
export function fitScanOutlines(batch: ScanOutlines, width: number, height: number): ScanOutline[] {
	const scale = Math.min(width / batch.width, height / batch.height);
	const left = (width - batch.width * scale) / 2;
	const top = (height - batch.height * scale) / 2;
	return batch.outlines.map(outline => ({...outline, x: left + outline.x * scale, y: top + outline.y * scale, width: outline.width * scale, height: outline.height * scale}));
}
export function parseScanOutlines(value: unknown): ScanOutlines | undefined {
	if (!value || typeof value !== 'object') {return;}
	const data = value as ScanOutlines;
	if (data.type !== 'scan-outlines' || !Number.isFinite(data.width) || !Number.isFinite(data.height) || data.width <= 0 || data.height <= 0 || data.width > 20000 || data.height > 20000 || !Array.isArray(data.outlines) || data.outlines.length > 100) {return;}
	if (!data.outlines.every(rect => rect && typeof rect.name === 'string' && rect.name.length <= 200 && [rect.id, rect.count, rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0 && (rect.didCommit === 0 || rect.didCommit === 1))) {return;}
	return data;
}
