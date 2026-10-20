import {useEffect} from 'react';

const selector = 'details.devtools-menu, details.device-settings';
export function ToolbarMenus() {
	useEffect(() => {
		const closeOthers = (target?: Node | null) => {
			for (const menu of document.querySelectorAll<HTMLDetailsElement>(selector)) {
				if (menu.open && !menu.contains(target ?? null)) {menu.open = false;}
			}
		};
		const outside = (event: Event) => closeOthers(event.target as Node);
		const toggle = (event: Event) => {
			const menu = event.target as HTMLDetailsElement;
			if (menu.matches?.(selector) && menu.open) {closeOthers(menu);}
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') {return;}
			const menu = Array.from(document.querySelectorAll<HTMLDetailsElement>(selector)).find(menu => menu.open);
			closeOthers(); menu?.querySelector<HTMLElement>('summary')?.focus();
		};
		const blur = () => closeOthers();
		document.addEventListener('pointerdown', outside, true); document.addEventListener('toggle', toggle, true);
		document.addEventListener('keydown', escape); window.addEventListener('blur', blur);
		return () => {document.removeEventListener('pointerdown', outside, true); document.removeEventListener('toggle', toggle, true); document.removeEventListener('keydown', escape); window.removeEventListener('blur', blur);};
	}, []);
	return null;
}
