import {useEffect, useRef} from 'react';
import {drawCanvas, updateOutlines} from '../media/scanRenderer';
import type {ExtensionMessage} from '../../../shared/protocol';
import {fitScanOutlines} from '../../../shared/scan';

export function ScanOverlay({enabled}: {enabled: boolean}) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		if (!enabled) {return;}
		const canvas = ref.current;
		const parent = canvas?.parentElement;
		if (!canvas || !parent) {return;}
		const context = canvas.getContext('2d');
		if (!context) {return;}
		const active = new Map<string, unknown>();
		let frame = 0;
		const density = window.devicePixelRatio || 1;
		let viewport = {width: parent.clientWidth, height: parent.clientHeight};
		const clear = () => {active.clear(); context.clearRect(0, 0, canvas.width, canvas.height);};
		const resize = () => {
			clear(); viewport = {width: parent.clientWidth, height: parent.clientHeight};
			canvas.width = Math.round(viewport.width * density); canvas.height = Math.round(viewport.height * density);
			context.setTransform(density, 0, 0, density, 0, 0);
		};
		const observer = new ResizeObserver(resize); observer.observe(parent); resize();
		const draw = () => {
			frame = 0;
			if (drawCanvas(context, canvas, density, active)) {frame = requestAnimationFrame(draw);}
		};
		const receive = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data?.type === 'devtools' && (!event.data.enabled || !event.data.active)) {clear();}
			if (!enabled || event.data?.type !== 'scan-outlines') {return;}
			if (active.size > 1000) {clear();}
			updateOutlines(active, fitScanOutlines(event.data, viewport.width, viewport.height));
			if (!frame) {frame = requestAnimationFrame(draw);}
		};
		window.addEventListener('message', receive);
		return () => {observer.disconnect(); window.removeEventListener('message', receive); cancelAnimationFrame(frame); clear();};
	}, [enabled]);
	return <canvas ref={ref} className="scan-overlay" aria-hidden="true" />;
}
