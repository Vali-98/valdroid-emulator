import * as React from 'react';
import {SquareMousePointer, X} from 'lucide-react';
import type {ExtensionMessage} from '../../../shared/protocol';
import type {InspectorResult} from '../../../shared/inspector';
import {visibleImageRect} from '../input/input';
import {vscode} from '../../shared/vscode';

export function useElementInspector(active: boolean) {
	const [selecting, setSelecting] = React.useState(false);
	const [result, setResult] = React.useState<InspectorResult>();
	const [popup, setPopup] = React.useState(false);
	const [waiting, setWaiting] = React.useState(false);
	const [anchor, setAnchor] = React.useState({x: 0, y: 0});
	const latest = React.useRef({id: 0, hover: false, open: false});
	const pending = React.useRef<{x: number; y: number} | undefined>(undefined);
	const busy = React.useRef(false);
	const timeout = React.useRef<ReturnType<typeof setTimeout>>(undefined);
	const request = React.useCallback((point: {x: number; y: number}, hover: boolean, open = false) => {
		if (hover && busy.current) {pending.current = point; return;}
		pending.current = undefined;
		clearTimeout(timeout.current);
		const id = Math.max(Date.now(), latest.current.id + 1);
		latest.current = {id, hover, open}; busy.current = true;
		vscode.postMessage({type: 'inspect-point', id, ...point, select: !hover});
		if (!hover) {setWaiting(true); setResult(undefined);}
		timeout.current = setTimeout(() => {
			busy.current = false; setWaiting(false);
			setResult({type: 'inspector-result', id, width: 1, height: 1, elements: [], error: 'Inspector did not respond. Restart the app with Valdroid.'});
		}, 6000);
	}, []);
	const dismiss = React.useCallback(() => {
		latest.current.id = 0; pending.current = undefined; busy.current = false;
		clearTimeout(timeout.current); setResult(undefined); setPopup(false); setWaiting(false);
	}, []);
	React.useEffect(() => {
		if (!active) {setSelecting(false); dismiss();}
	}, [active, dismiss]);
	React.useEffect(() => {
		const receive = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data?.type !== 'inspector-result' || event.data.id !== latest.current.id) {return;}
			const data = event.data;
			setResult(data);
			if (latest.current.hover || data.resolved || data.error) {
				clearTimeout(timeout.current); busy.current = false; setWaiting(false);
				if (latest.current.open && data.resolved) {
					latest.current.open = false;
					const index = data.elements.findIndex(element => element.source && !element.source.fileName.includes('/node_modules/'));
					if (index >= 0) {
						vscode.postMessage({type: 'inspect-open-source', id: data.id, index});
						setSelecting(false); dismiss(); return;
					}
					setResult({...data, error: 'Source location unavailable for this component.'});
				}
				const point = pending.current;
				if (point && latest.current.hover) {request(point, true);}
			}
		};
		const escape = (event: KeyboardEvent) => {if (event.key === 'Escape') {setSelecting(false); dismiss();}};
		window.addEventListener('message', receive); window.addEventListener('keydown', escape);
		return () => {window.removeEventListener('message', receive); window.removeEventListener('keydown', escape); clearTimeout(timeout.current);};
	}, [dismiss, request]);
	const pointFor = (event: React.MouseEvent) => {
		const image = event.currentTarget.querySelector<HTMLCanvasElement>('#screen');
		if (!image || !image.width || !image.height) {return;}
		const rect = visibleImageRect(image);
		const x = (event.clientX - rect.left) / rect.width;
		const y = (event.clientY - rect.top) / rect.height;
		if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < 1 && y < 1) {return {x, y};}
	};
	const anchorAt = (event: React.MouseEvent) => {
		const rect = event.currentTarget.getBoundingClientRect();
		setAnchor({x: event.clientX - rect.left, y: event.clientY - rect.top});
	};
	const isPopup = (event: React.MouseEvent) => (event.target as HTMLElement).closest('.inspector-popup');
	const screenProps: React.HTMLAttributes<HTMLDivElement> = {
		onContextMenuCapture: event => {
			if (!active || isPopup(event)) {return;}
			event.preventDefault(); event.stopPropagation();
			const point = pointFor(event);
			if (point) {anchorAt(event); setPopup(true); request(point, false);}
		},
		onPointerMoveCapture: event => {
			if (!active || !selecting || popup || isPopup(event)) {return;}
			event.stopPropagation();
			anchorAt(event);
			const point = pointFor(event);
			if (point) {request(point, true);}
		},
		onPointerDownCapture: event => {
			if (!active || isPopup(event)) {return;}
			if (selecting) {
				event.preventDefault(); event.stopPropagation();
				if (event.button === 0) {
					const point = pointFor(event);
					if (point) {anchorAt(event); setPopup(false); request(point, false, true);}
				}
			} else if (popup) {dismiss();}
		},
		onPointerUpCapture: event => {if (selecting && !isPopup(event)) {event.preventDefault(); event.stopPropagation();}},
		onWheelCapture: event => {if (selecting && !isPopup(event)) {event.stopPropagation();}},
		onPointerLeave: () => {if (selecting && !popup) {dismiss();}},
	};
	return {selecting, result, popup, waiting, anchor, screenProps, dismiss,
		toggle: () => {dismiss(); setSelecting(value => !value);}};
}

export function InspectorButton({selected, onClick}: {selected: boolean; onClick: () => void}) {
	return <button type="button" className="inspector-button" aria-label="Inspect element" title="Inspect element (Escape to cancel)" aria-pressed={selected} onClick={onClick}><SquareMousePointer size={16} /></button>;
}

export function InspectorOverlay({inspector}: {inspector: ReturnType<typeof useElementInspector>}) {
	const {result, popup, waiting, dismiss, selecting, anchor} = inspector;
	const ref = React.useRef<HTMLDivElement>(null);
	const popupRef = React.useRef<HTMLElement>(null);
	const [popupSize, setPopupSize] = React.useState({width: 240, height: 40});
	const showPopup = popup || selecting && Boolean(result || waiting);
	const [viewport, setViewport] = React.useState({width: 0, height: 0});
	React.useEffect(() => {
		const node = ref.current;
		if (!node) {return;}
		const resize = () => setViewport({width: node.clientWidth, height: node.clientHeight});
		const observer = new ResizeObserver(resize); observer.observe(node); resize();
		return () => observer.disconnect();
	}, []);
	React.useLayoutEffect(() => {
		const node = popupRef.current;
		if (!node || !showPopup) {return;}
		const resize = () => setPopupSize({width: node.offsetWidth, height: node.offsetHeight});
		const observer = new ResizeObserver(resize); observer.observe(node); resize();
		return () => observer.disconnect();
	}, [showPopup, popup]);
	const position = {
		left: Math.max(8, Math.min(anchor.x + 12, viewport.width - popupSize.width - 8)),
		top: Math.max(8, Math.min(anchor.y + 12, viewport.height - popupSize.height - 8)),
	};
	const scale = result ? Math.min(viewport.width / result.width, viewport.height / result.height) : 0;
	const frame = result?.frame;
	return <div ref={ref} className="inspector-overlay">
		{frame && <div className="inspector-highlight" style={{left: (viewport.width - result!.width * scale) / 2 + frame.x * scale, top: (viewport.height - result!.height * scale) / 2 + frame.y * scale, width: frame.width * scale, height: frame.height * scale}} />}
		{showPopup && <section ref={popupRef} className={`inspector-popup ${popup ? '' : 'inspector-tooltip'}`} style={position} aria-label={popup ? 'Component hierarchy' : 'Hovered component'}>
			{popup && <div className="inspector-heading">Component hierarchy<button type="button" aria-label="Dismiss inspector" onClick={dismiss}><X size={14} /></button></div>}
			{!popup && !waiting && !result?.error && <p>{result?.elements[0]?.name} · Click to open source</p>}
			{waiting && <p>Resolving component source…</p>}
			{result?.error && <p role="status">{result.error}</p>}
			{popup && result?.elements.map((element, index) => element.source && <button type="button" key={index} title={`${element.source.fileName}:${element.source.lineNumber}`} onClick={() => {vscode.postMessage({type: 'inspect-open-source', id: result.id, index}); dismiss();}}><span>{element.name}</span><small>{element.source.fileName.split('/').pop()}:{element.source.lineNumber}</small></button>)}
			{popup && result?.resolved && !waiting && !result.error && !result.elements.some(element => element.source) && <p>No source-linked components at this position.</p>}
		</section>}
	</div>;
}
