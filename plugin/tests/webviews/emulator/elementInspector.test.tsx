import {act, fireEvent, render} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import type {InspectorResult} from '../../../src/shared/inspector';

const postMessage = vi.fn();
vi.mock('../../../src/webviews/shared/vscode', () => ({vscode: {postMessage: (...args: unknown[]) => postMessage(...args)}}));
import {InspectorButton, InspectorOverlay, useElementInspector} from '../../../src/webviews/emulator/components/ElementInspector';
import {Header} from '../../../src/webviews/emulator/components/Header';

function mount(active = true) {
	const appClick = vi.fn();
	function Screen() {
		const inspector = useElementInspector(active);
		return <><InspectorButton selected={inspector.selecting} onClick={inspector.toggle} /><div {...inspector.screenProps}><canvas id="screen" width={400} height={800} onPointerDown={appClick} /></div><output>{inspector.popup ? 'popup' : ''}{inspector.result?.elements[0]?.name}</output></>;
	}
	const view = render(<Screen />);
	const canvas = view.container.querySelector('canvas')!;
	canvas.getBoundingClientRect = () => new DOMRect(0, 0, 200, 400);
	return {...view, canvas, appClick};
}
const reply = (data: InspectorResult) => act(() => window.dispatchEvent(new MessageEvent('message', {data})));

it('right-click requests the clicked screen position without tapping the app', () => {
	const r = mount();
	fireEvent.contextMenu(r.canvas, {clientX: 50, clientY: 100});
	expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type: 'inspect-point', x: 0.25, y: 0.25, select: true}));
	expect(r.appClick).not.toHaveBeenCalled();
	expect(r.container.querySelector('output')?.textContent).toBe('popup');
});
it('selector captures clicks and opens source after symbolication; Escape cancels selection', () => {
	const r = mount();
	fireEvent.click(r.getByLabelText('Inspect element'));
	const down = new MouseEvent('pointerdown', {bubbles: true, cancelable: true, clientX: 100, clientY: 200, button: 0});
	fireEvent(r.canvas, down);
	expect(r.appClick).not.toHaveBeenCalled();
	expect(r.container.querySelector('output')?.textContent).not.toContain('popup');
	const request = postMessage.mock.calls.at(-1)![0];
	reply({type: 'inspector-result', id: request.id, width: 400, height: 800, elements: [{name: 'Card', source: {fileName: '/project/Card.tsx', lineNumber: 3, columnNumber: 1}}], resolved: true});
	expect(postMessage).toHaveBeenLastCalledWith({type: 'inspect-open-source', id: request.id, index: 0});
	fireEvent.click(r.getByLabelText('Inspect element'));
	fireEvent.keyDown(window, {key: 'Escape'});
	expect(r.getByLabelText('Inspect element').getAttribute('aria-pressed')).toBe('false');
});
it('does not intercept generic emulator right-clicks', () => {
	const r = mount(false);
	fireEvent.contextMenu(r.canvas, {clientX: 50, clientY: 100});
	expect(postMessage).not.toHaveBeenCalled();
});

it('places the inspector button in the main toolbar with a pressed state', () => {
	const toggle = vi.fn();
	const r = render(<Header title="Phone" loaded devtools={{type: 'devtools', active: true, enabled: false, connected: true}} inspecting onToggleInspector={toggle} />);
	const button = r.getByLabelText('Inspect element');
	expect(button.closest('.topbar-actions')).not.toBeNull();
	expect(button.getAttribute('aria-pressed')).toBe('true');
	fireEvent.click(button);
	expect(toggle).toHaveBeenCalledOnce();
});

it('anchors right-click hierarchy next to the cursor without enabling selector mode', () => {
	vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
	vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80);
	function Screen() {
		const inspector = useElementInspector(true);
		return <div {...inspector.screenProps}><canvas id="screen" width={400} height={800} /><InspectorOverlay inspector={inspector} /></div>;
	}
	const r = render(<Screen />);
	const canvas = r.container.querySelector('canvas')!;
	canvas.getBoundingClientRect = () => new DOMRect(0, 0, 400, 800);
	fireEvent.contextMenu(canvas, {clientX: 50, clientY: 100});
	const popup = r.getByLabelText('Component hierarchy');
	expect(popup.style.left).toBe('62px');
	expect(popup.style.top).toBe('112px');
	const request = postMessage.mock.calls.at(-1)![0];
	reply({type: 'inspector-result', id: request.id, width: 400, height: 800, resolved: true, elements: [
		{name: 'InternalView'},
		{name: 'Card', source: {fileName: '/project/Card.tsx', lineNumber: 8, columnNumber: 1}},
	]});
	expect(r.queryByText('InternalView')).toBeNull();
	expect(r.queryByText('Source unavailable')).toBeNull();
	fireEvent.click(r.getByText('Card'));
	// Filtering must preserve the original index used by the host's source lookup.
	expect(postMessage).toHaveBeenLastCalledWith({type: 'inspect-open-source', id: request.id, index: 1});
});
