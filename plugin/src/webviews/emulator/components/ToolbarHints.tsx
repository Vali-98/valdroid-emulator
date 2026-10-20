import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

export function ToolbarHints() {
	const [hint, setHint] = useState<{text: string; rect: DOMRect; side: 'left' | 'bottom'} | undefined>();
	const tooltip = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (!hint || !tooltip.current) {return;}
		const element = tooltip.current;
		element.style.left = '0px'; element.style.top = '0px';
		const {width, height} = element.getBoundingClientRect();
		const {rect, side} = hint;
		const x = side === 'left' ? rect.left - width - 8 : rect.left + rect.width / 2 - width / 2;
		const y = side === 'left' ? rect.top + rect.height / 2 - height / 2 : rect.bottom + height + 8 <= window.innerHeight - 8 ? rect.bottom + 8 : rect.top - height - 8;
		element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
		element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
		element.style.visibility = 'visible';
	}, [hint]);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let target: HTMLElement | undefined, title: string | null = null, described: string | null = null;
		const hide = () => {
			clearTimeout(timer); setHint(undefined);
			if (target) {if (title !== null) {target.setAttribute('title', title);} if (described === null) {target.removeAttribute('aria-describedby');} else {target.setAttribute('aria-describedby', described);}}
			target = undefined;
		};
		const show = (event: Event) => {
			if (document.querySelector('.devtools-menu[open], .device-settings[open]')) {hide(); return;}
			const element = (event.target as Element)?.closest<HTMLElement>('.topbar button, .topbar summary, .device-settings summary');
			if (!element || element === target) {return;}
			hide(); target = element; title = element.getAttribute('title'); described = element.getAttribute('aria-describedby');
			const text = element.dataset.hint ?? element.getAttribute('aria-label') ?? title;
			if (!text) {return;}
			element.removeAttribute('title');
			timer = setTimeout(() => {
				if (document.querySelector('.devtools-menu[open], .device-settings[open]')) {hide(); return;}
				const rect = element.getBoundingClientRect();
				element.setAttribute('aria-describedby', 'toolbar-hint');
				setHint({text, rect, side: element.closest('.device-settings') ? 'left' : 'bottom'});
			}, 300);
		};
		const leave = (event: Event) => {if (target && !target.contains((event as MouseEvent).relatedTarget as Node | null)) {hide();}};
		const toggle = (event: Event) => {if ((event.target as Element).matches?.('.devtools-menu, .device-settings')) {hide();}};
		document.addEventListener('toggle', toggle, true);
		document.addEventListener('mouseover', show); document.addEventListener('focusin', show);
		document.addEventListener('mouseout', leave); document.addEventListener('focusout', hide);
		document.addEventListener('pointerdown', hide); window.addEventListener('blur', hide); window.addEventListener('resize', hide);
		const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {hide();}}; document.addEventListener('keydown', key);
		return () => {hide(); document.removeEventListener('toggle', toggle, true); document.removeEventListener('mouseover', show); document.removeEventListener('focusin', show); document.removeEventListener('mouseout', leave); document.removeEventListener('focusout', hide); document.removeEventListener('pointerdown', hide); document.removeEventListener('keydown', key); window.removeEventListener('blur', hide); window.removeEventListener('resize', hide);};
	}, []);
	return hint ? createPortal(<div ref={tooltip} id="toolbar-hint" role="tooltip" className="toolbar-hint" style={{left: 0, top: 0, visibility: 'hidden'}}>{hint.text}</div>, document.body) : null;
}
