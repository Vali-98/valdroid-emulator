import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, RefreshCw, Search} from 'lucide-react';
import {useVirtualizer} from '@tanstack/react-virtual';
import type {ConsoleMessage} from '../../shared/console';
import type {HierarchyNode, HierarchySnapshot} from '../../shared/hierarchy';
import {ValueTree} from './JSConsole';
import {bridge} from './bridge';
import {HierarchyScrollbar} from './HierarchyScrollbar';

const indentation = 8;

export function Hierarchy({focusId, focusVersion = 0}: {focusId?: string; focusVersion?: number}) {
	const [snapshot, setSnapshot] = useState<HierarchySnapshot>({type: 'hierarchy-snapshot', nodes: []});
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [focusedRoot, setFocusedRoot] = useState<string>();
	const [query, setQuery] = useState('');
	const [propsWidth, setPropsWidth] = useState(() => {
		const saved = bridge.getState?.()?.hierarchyPropsWidth;
		return typeof saved === 'number' && Number.isFinite(saved) ? Math.max(15, Math.min(75, saved)) : 35;
	});
	const content = useRef<HTMLDivElement>(null);
	const dragging = useRef<number | undefined>(undefined);
	const width = useRef(propsWidth);
	const resize = (next: number, save = false) => {
		width.current = Math.max(15, Math.min(75, next)); setPropsWidth(width.current);
		if (save) {bridge.setState?.({...bridge.getState?.(), hierarchyPropsWidth: width.current});}
	};
	const [reveal, setReveal] = useState(focusId);
	const viewport = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const receive = (event: MessageEvent<ConsoleMessage>) => {if (event.data?.type === 'hierarchy-snapshot') {setSnapshot(event.data);}};
		window.addEventListener('message', receive);
		bridge.postMessage({type: 'hierarchy-active', active: true});
		return () => {window.removeEventListener('message', receive); bridge.postMessage({type: 'hierarchy-search', query: ''}); bridge.postMessage({type: 'hierarchy-active', active: false});};
	}, []);
	useEffect(() => {
		const timeout = setTimeout(() => bridge.postMessage({type: 'hierarchy-search', query}), 200);
		return () => clearTimeout(timeout);
	}, [query]);
	useEffect(() => {if (focusId) {setQuery(''); setFocusedRoot(undefined); setReveal(focusId);}}, [focusId, focusVersion]);
	const byID = useMemo(() => new Map(snapshot.nodes.map(node => [node.id, node])), [snapshot.nodes]);
	// Only an explicit inspector jump opens an ancestor path automatically.
	useEffect(() => {
		if (!reveal || !byID.has(reveal)) {return;}
		const ancestors: string[] = [];
		let parent = byID.get(reveal)?.parentId;
		while (parent) {ancestors.push(parent); parent = byID.get(parent)?.parentId;}
		setExpanded(previous => new Set([...previous, ...ancestors]));
	}, [reveal, byID]);
	const parents = useMemo(() => new Set(snapshot.nodes.flatMap(node => node.parentId ? [node.parentId] : [])), [snapshot.nodes]);
	const root = focusedRoot ? byID.get(focusedRoot) : undefined;
	const scopedNodes = useMemo(() => {
		if (!root) {return snapshot.nodes;}
		const included = new Set([root.id]);
		return snapshot.nodes.filter(node => {
			if (node.id === root.id || node.parentId && included.has(node.parentId)) {included.add(node.id); return true;}
			return false;
		});
	}, [snapshot.nodes, root]);
	const rows = useMemo(() => {
		const visible = new Set<string>();
		if (query) {
			for (const node of scopedNodes) {
				if (!node.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {continue;}
				let current: HierarchyNode | undefined = node;
				while (current && !visible.has(current.id)) {visible.add(current.id); current = current.parentId ? byID.get(current.parentId) : undefined;}
			}
		}
		const depths = new Map<string, number>(), hidden = new Set<string>();
		return scopedNodes.flatMap(node => {
			const depth = node.parentId && depths.has(node.parentId) ? depths.get(node.parentId)! + 1 : 0;
			depths.set(node.id, depth);
			if (node.id !== root?.id && node.parentId && (hidden.has(node.parentId) || !expanded.has(node.parentId))) {hidden.add(node.id); return [];}
			return query && !visible.has(node.id) ? [] : [{...node, depth}];
		});
	}, [scopedNodes, expanded, query, byID, root]);
	const virtual = useVirtualizer({count: rows.length, getScrollElement: () => viewport.current, estimateSize: () => 28, overscan: 12});
	useEffect(() => {
		if (!reveal) {return;}
		const index = rows.findIndex(node => node.id === reveal);
		if (index >= 0) {
			virtual.scrollToIndex(index, {align: 'center'});
			// Vertical virtualization doesn't reveal the label along the other axis.
			if (viewport.current) {viewport.current.scrollLeft = Math.max(0, rows[index].depth * indentation - 24);}
			setReveal(undefined);
		}
	}, [reveal, rows, virtual]);
	const selected = snapshot.selectedId ? byID.get(snapshot.selectedId) : undefined;
	// Give the virtualized list a stable horizontal extent even when its deepest
	// rows are outside the current vertical viewport.
	const treeWidth = useMemo(() => Math.max(0, ...rows.map(node => node.depth * indentation + 30 + node.name.length * 9)), [rows]);
	return <section className="hierarchy-panel" role="tabpanel" aria-label="Hierarchy">
		<header className="console-toolbar">
			<label className="console-search"><Search size={15} /><input aria-label="Search components" placeholder="Search components" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></label>
			<div className="console-actions">
				<button aria-label="Collapse all components" title="Collapse all" onClick={() => {setReveal(undefined); setExpanded(new Set());}}><ChevronsDownUp size={15} /></button>
				<button aria-label="Expand all components" title="Expand all" onClick={() => setExpanded(new Set(scopedNodes.filter(node => parents.has(node.id)).map(node => node.id)))}><ChevronsUpDown size={15} /></button>
				<button aria-label="Refresh hierarchy" title="Refresh hierarchy" onClick={() => bridge.postMessage({type: 'hierarchy-refresh'})}><RefreshCw size={15} /></button>
			</div>
		</header>
		{root && <div className="hierarchy-root-bar"><button type="button" aria-label="Show full hierarchy" onClick={() => {setFocusedRoot(undefined); if (viewport.current) {viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0;}}}><ArrowLeft size={14} />All components</button><span>{root.name}</span></div>}
		<div className="hierarchy-content" ref={content} style={{gridTemplateColumns: `minmax(100px, ${propsWidth}%) 5px minmax(0, 1fr)`}}>
			<aside className="hierarchy-props" aria-label="Component props"><h3>{selected?.name ?? 'Props'}</h3>
				{snapshot.props && selected ? <div key={selected.id} className="hierarchy-values">{snapshot.props.entries?.length ? snapshot.props.entries.map(entry => <ValueTree key={entry.key} property={entry.key} value={entry.value} />) : <ValueTree value={snapshot.props} />}</div> : <p>Select a component to inspect its props.</p>}
			</aside>
			<div className="hierarchy-divider" role="separator" aria-label="Resize props pane" aria-orientation="vertical" tabIndex={0} aria-valuemin={15} aria-valuemax={75} aria-valuenow={propsWidth}
				onPointerDown={event => {if (event.button !== 0) {return;} event.preventDefault(); dragging.current = event.pointerId; event.currentTarget.setPointerCapture?.(event.pointerId);}}
				onPointerMove={event => {if (dragging.current !== event.pointerId) {return;} const rect = content.current?.getBoundingClientRect(); if (rect?.width) {resize((event.clientX - rect.left) / rect.width * 100);}}}
				onPointerUp={event => {if (dragging.current === event.pointerId) {dragging.current = undefined; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {event.currentTarget.releasePointerCapture(event.pointerId);} resize(width.current, true);}}}
				onPointerCancel={() => {dragging.current = undefined;}}
				onLostPointerCapture={() => {dragging.current = undefined;}}
				onKeyDown={event => {if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault(); resize(width.current + (event.key === 'ArrowRight' ? 2 : -2), true);}}} />
			<div className="hierarchy-tree-pane">
			<div className="hierarchy-tree" ref={viewport} role="tree" aria-label="React components" onMouseLeave={() => bridge.postMessage({type: 'hierarchy-hover'})}>
				{(!rows.length || snapshot.error) && <p className="console-empty">{snapshot.error ?? (query ? 'No matching components.' : 'Loading React hierarchy…')}</p>}
				<div style={{height: virtual.getTotalSize(), position: 'relative', minWidth: '100%', width: treeWidth}}>
					{virtual.getVirtualItems().map(item => {
						const node = rows[item.index];
						return <div key={node.id} role="treeitem" tabIndex={0} aria-level={node.depth + 1} aria-selected={snapshot.selectedId === node.id}
							aria-expanded={parents.has(node.id) ? expanded.has(node.id) : undefined} className={`hierarchy-row${item.index > 0 && rows[item.index - 1].depth > node.depth ? ' hierarchy-branch-start' : ''}`}
								style={{height: item.size, transform: `translateY(${item.start}px)`, paddingLeft: node.depth * indentation}}
							onMouseEnter={() => bridge.postMessage({type: 'hierarchy-hover', id: node.id})}
							onClick={() => bridge.postMessage({type: 'hierarchy-select', id: node.id})}
							onDoubleClick={event => {if ((event.target as HTMLElement).closest('button')) {return;} setFocusedRoot(node.id); setQuery(''); setReveal(undefined); bridge.postMessage({type: 'hierarchy-hover'}); if (viewport.current) {viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0;}}}
							onKeyDown={event => {if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault(); bridge.postMessage({type: 'hierarchy-select', id: node.id});}}}>
							{parents.has(node.id) ? <button type="button" className="hierarchy-disclosure" aria-label={`${expanded.has(node.id) ? 'Collapse' : 'Expand'} ${node.name}`} onClick={event => {event.stopPropagation(); setExpanded(previous => {const next = new Set(previous); if (next.has(node.id)) {next.delete(node.id);} else {next.add(node.id);} return next;});}}>{expanded.has(node.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="hierarchy-indent" />}
							<span>{node.name}</span>
						</div>;
					})}
				</div>
			</div>
			<HierarchyScrollbar viewport={viewport} contentWidth={treeWidth} />
			</div>
		</div>
		<footer className="console-footer">Props are bounded snapshots · {snapshot.nodes.length} components{snapshot.truncated ? ' · Tree truncated' : ''}</footer>
	</section>;
}
