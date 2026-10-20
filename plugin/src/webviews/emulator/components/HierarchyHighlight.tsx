import {useEffect, useRef, useState} from 'react';
import type {ExtensionMessage} from '../../../shared/protocol';
import type {HierarchyHighlight as Highlight} from '../../../shared/hierarchy';

export function HierarchyHighlight() {
	const ref = useRef<HTMLDivElement>(null);
	const [highlight, setHighlight] = useState<Highlight>();
	const [viewport, setViewport] = useState({width: 0, height: 0});
	useEffect(() => {
		const node = ref.current;
		if (!node) {return;}
		const resize = () => setViewport({width: node.clientWidth, height: node.clientHeight});
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined;
		observer?.observe(node); resize();
		const receive = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data?.type === 'hierarchy-highlight') {setHighlight(event.data);}
			if (event.data?.type === 'devtools' && !event.data.active) {setHighlight(undefined);}
		};
		window.addEventListener('message', receive);
		return () => {observer?.disconnect(); window.removeEventListener('message', receive);};
	}, []);
	const frame = highlight?.frame;
	const scale = highlight ? Math.min(viewport.width / highlight.width, viewport.height / highlight.height) : 0;
	return <div ref={ref} className="inspector-overlay" aria-hidden="true">{frame && highlight && <div className="inspector-highlight" style={{left: (viewport.width - highlight.width * scale) / 2 + frame.x * scale, top: (viewport.height - highlight.height * scale) / 2 + frame.y * scale, width: frame.width * scale, height: frame.height * scale}} />}</div>;
}
