import {parseJSLogs, type JSValue} from './jsConsole';
import {parseInspectorResult, type InspectorResult} from './inspector';

export interface HierarchyNode {id: string; parentId?: string; name: string;}
export interface HierarchySnapshot {type: 'hierarchy-snapshot'; nodes: HierarchyNode[]; version?: number; selectedId?: string; props?: JSValue; truncated?: boolean; error?: string;}
export interface HierarchyHighlight {type: 'hierarchy-highlight'; id?: string; width: number; height: number; frame?: InspectorResult['frame'];}
export interface HierarchyControl {active: boolean; selectedId?: string; hoveredId?: string; version: number; query?: string;}
export const validHierarchyId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9:-]{1,100}$/.test(id);
export function parseHierarchySnapshot(value: unknown): HierarchySnapshot | undefined {
	if (!value || typeof value !== 'object') {return;}
	const data = value as HierarchySnapshot;
	if (data.type !== 'hierarchy-snapshot' || !Array.isArray(data.nodes) || data.nodes.length > 3000 ||
		(data.version !== undefined && (!Number.isSafeInteger(data.version) || data.version < 0)) ||
		(data.selectedId !== undefined && !validHierarchyId(data.selectedId)) ||
		(data.truncated !== undefined && typeof data.truncated !== 'boolean') ||
		(data.error !== undefined && (typeof data.error !== 'string' || data.error.length > 500))) {return;}
	const seen = new Set<string>();
	for (const node of data.nodes) {
		if (!node || !validHierarchyId(node.id) || seen.has(node.id) || typeof node.name !== 'string' || node.name.length > 200 ||
			(node.parentId !== undefined && !seen.has(node.parentId))) {return;}
		seen.add(node.id);
	}
	if (data.props !== undefined && !parseJSLogs({type: 'js-logs', records: [{level: 'log', time: 0, args: [data.props]}]})) {return;}
	return data;
}
export function parseHierarchyHighlight(value: unknown): HierarchyHighlight | undefined {
	if (!value || typeof value !== 'object' || (value as HierarchyHighlight).type !== 'hierarchy-highlight') {return;}
	if ((value as HierarchyHighlight).id !== undefined && !validHierarchyId((value as HierarchyHighlight).id)) {return;}
	return parseInspectorResult({...value, type: 'inspector-result', id: 1, elements: []}) ? value as HierarchyHighlight : undefined;
}
