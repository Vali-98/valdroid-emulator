import {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';

export function ToolbarHints() {
	const [hint, setHint] = useState<{text: string; x: number; y: number} | undefined>();
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let target: HTMLElement | undefined, title: string | null = null, described: string | null = null;
		const hide = () => {
			clearTimeout(timer); setHint(undefined);
			if (target) {if (title !== null) {target.setAttribute('title', title);} if (described === null) {target.removeAttribute('aria-describedby');} else {target.setAttribute('aria-describedby', described);}}
			target = undefined;
		};
		const show = (event: Event) => {
			const element = (event.target as Element)?.closest<HTMLElement>('.topbar button, .topbar summary, .device-rail button, .device-settings summary');
			if (!element || element === target) {return;}
			hide(); target = element; title = element.getAttribute('title'); described = element.getAttribute('aria-describedby');
			const text = element.dataset.hint ?? element.getAttribute('aria-label') ?? title;
			if (!text) {return;}
			element.removeAttribute('title');
			timer = setTimeout(() => {
				const rect = element.getBoundingClientRect();
				element.setAttribute('aria-describedby', 'toolbar-hint');
				setHint({text, x: Math.max(8, Math.min(rect.left, window.innerWidth - 228)), y: Math.max(8, Math.min(rect.bottom + 7, window.innerHeight - 64))});
			}, 300);
		};
		const leave = (event: Event) => {if (target && !target.contains((event as MouseEvent).relatedTarget as Node | null)) {hide();}};
		document.addEventListener('mouseover', show); document.addEventListener('focusin', show);
		document.addEventListener('mouseout', leave); document.addEventListener('focusout', hide);
		document.addEventListener('pointerdown', hide); window.addEventListener('blur', hide); window.addEventListener('resize', hide);
		const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {hide();}}; document.addEventListener('keydown', key);
		return () => {hide(); document.removeEventListener('mouseover', show); document.removeEventListener('focusin', show); document.removeEventListener('mouseout', leave); document.removeEventListener('focusout', hide); document.removeEventListener('pointerdown', hide); document.removeEventListener('keydown', key); window.removeEventListener('blur', hide); window.removeEventListener('resize', hide);};
	}, []);
	return hint ? createPortal(<div id="toolbar-hint" role="tooltip" className="toolbar-hint" style={{left: hint.x, top: hint.y}}>{hint.text}</div>, document.body) : null;
}
