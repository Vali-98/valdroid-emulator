import {useEffect, useState, type CSSProperties, type RefObject} from 'react';

// A real DOM control, not an OS overlay scrollbar that the webview can hide.
export function HierarchyScrollbar({viewport, contentWidth}: {viewport: RefObject<HTMLDivElement | null>; contentWidth: number}) {
	const [position, setPosition] = useState({width: 0, left: 0});
	useEffect(() => {
		const element = viewport.current;
		if (!element) {return;}
		const update = () => setPosition({width: element.clientWidth, left: element.scrollLeft});
		const wheel = (event: WheelEvent) => {
			if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {return;}
			const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
			if (!delta) {return;}
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
			element.scrollLeft = Math.max(0, Math.min(contentWidth - element.clientWidth, element.scrollLeft + delta * unit));
			event.preventDefault(); update();
		};
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined;
		observer?.observe(element); element.addEventListener('scroll', update); update();
		element.addEventListener('wheel', wheel, {passive: false});
		return () => {observer?.disconnect(); element.removeEventListener('scroll', update); element.removeEventListener('wheel', wheel);};
	}, [viewport, contentWidth]);
	const maximum = Math.max(0, contentWidth - position.width);
	if (!position.width || !maximum) {return null;}
	return <input type="range" className="hierarchy-horizontal-scrollbar" aria-label="Scroll hierarchy horizontally"
		min={0} max={maximum} step="any" value={Math.min(position.left, maximum)}
		style={{'--hierarchy-scroll-thumb': `${Math.max(24, position.width * position.width / contentWidth)}px`} as CSSProperties}
		onChange={event => {
			const left = Number(event.target.value);
			if (viewport.current) {viewport.current.scrollLeft = left;}
			setPosition(previous => ({...previous, left}));
		}} />;
}
