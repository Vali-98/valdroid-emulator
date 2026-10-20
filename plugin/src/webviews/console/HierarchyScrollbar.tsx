import {useEffect, useState, type CSSProperties, type RefObject} from 'react';

// A real DOM control, not an OS overlay scrollbar that the webview can hide.
export function HierarchyScrollbar({viewport, contentWidth}: {viewport: RefObject<HTMLDivElement | null>; contentWidth: number}) {
	const [position, setPosition] = useState({width: 0, left: 0});
	useEffect(() => {
		const element = viewport.current;
		if (!element) {return;}
		const update = () => setPosition({width: element.clientWidth, left: element.scrollLeft});
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined;
		observer?.observe(element); element.addEventListener('scroll', update); update();
		return () => {observer?.disconnect(); element.removeEventListener('scroll', update);};
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
