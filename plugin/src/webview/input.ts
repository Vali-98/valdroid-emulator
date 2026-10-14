import * as React from 'react';

export function activeDeviceName(status: string): string {
	const match = /^Connected\s*.\s*(.+)$/.exec(status);
	return match?.[1] || 'Emulator Loaded';
}

export function visibleImageRect(image: HTMLImageElement): { left: number; top: number; width: number; height: number } {
	const rect = image.getBoundingClientRect();
	const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
	const width = image.naturalWidth * scale;
	const height = image.naturalHeight * scale;
	return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

const keyCodes: Record<string, number> = {
	Enter: 66,
	Escape: 111,
	Backspace: 67,
	Tab: 61,
	' ': 62,
	ArrowUp: 19,
	ArrowDown: 20,
	ArrowLeft: 21,
	ArrowRight: 22,
	Home: 3,
	End: 123,
	PageUp: 92,
	PageDown: 93,
	Delete: 112,
	Shift: 59,
	Control: 113,
	Alt: 57,
	Meta: 117,
};

export function androidKeyCode(key: string): number {
	if (/^[a-z]$/i.test(key)) {return key.toUpperCase().charCodeAt(0) - 65 + 29;}
	if (/^[0-9]$/.test(key)) {return key === '0' ? 7 : Number(key) + 7;}
	return keyCodes[key] || 0;
}

export function metaState(event: React.KeyboardEvent): number {
	return (event.shiftKey ? 1 : 0) | (event.altKey ? 2 : 0) | (event.ctrlKey ? 0x1000 : 0) | (event.metaKey ? 0x10000 : 0);
}
