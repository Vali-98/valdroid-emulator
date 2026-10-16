import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEmulatorInput } from '../../../src/webviews/emulator/hooks/useEmulatorInput';

function mount(send = vi.fn<(command: object) => boolean>(() => true)) {
	function Screen() {
		const { imageRef, screenProps } = useEmulatorInput({ id:0, width:1080, height:2400, orientation:0 }, send);
		return <canvas {...screenProps} ref={imageRef} width={1080} height={2400} />;
	}
	const view = render(<Screen />);
	const screen = view.container.querySelector('canvas')!;
	screen.getBoundingClientRect = () => new DOMRect(0, 0, 1080, 2400);
	screen.setPointerCapture = vi.fn(); screen.releasePointerCapture = vi.fn(); screen.hasPointerCapture = () => true;
	const pointer = (type: string, fields = {}) => {
		const event = new Event(type, { bubbles:true, cancelable:true });
		Object.assign(event, { pointerId:1, pointerType:'mouse', clientX:540, clientY:1200, buttons:1, button:0, ...fields });
		fireEvent(screen, event);
	};
	return { ...view, send, screen, pointer };
}

it('sends DOWN before focus/capture and maps movement without waiting for render', () => {
	const { send, screen, pointer } = mount();
	const focus = vi.spyOn(screen, 'focus');
	pointer('pointerdown'); pointer('pointermove', { clientY:1800 }); pointer('pointerup', { buttons:0 });
	expect(send.mock.calls.map(args => (args[0] as {action:number}).action)).toEqual([0,2,1]);
	expect(send.mock.invocationCallOrder[0]).toBeLessThan(focus.mock.invocationCallOrder[0]);
});

it('sends CANCEL for interrupted gestures, not an extra UP after release', () => {
	const { send, pointer } = mount();
	pointer('pointerdown'); pointer('pointercancel'); pointer('lostpointercapture'); pointer('pointerup');
	expect(send.mock.calls.map(args => (args[0] as {action:number}).action)).toEqual([0,3]);
});

it('does not capture a gesture when its DOWN cannot be sent', () => {
	const { screen, pointer } = mount(vi.fn<(command: object) => boolean>(() => false));
	pointer('pointerdown'); expect(screen.setPointerCapture).not.toHaveBeenCalled();
});

it('ignores a second pointer until the active gesture ends', () => {
	const { send, pointer } = mount();
	pointer('pointerdown'); pointer('pointerdown', {pointerId:2}); pointer('pointerup', {pointerId:2}); pointer('pointerup');
	expect(send.mock.calls.map(args => (args[0] as {action:number}).action)).toEqual([0,1]);
});

it('cancels an active Android gesture when its canvas unmounts', () => {
	const {send, pointer, unmount} = mount();
	pointer('pointerdown'); unmount();
	expect(send.mock.calls.map(args => (args[0] as {action: number}).action)).toEqual([0,3]);
});

it('uses native raw moves when delivered and detaches them on unmount', () => {
	Object.defineProperty(HTMLCanvasElement.prototype, 'onpointerrawupdate', { configurable:true, value:null });
	try {
		const { send, pointer, unmount } = mount();
		pointer('pointerdown'); pointer('pointerrawupdate', { clientY:1800 }); pointer('pointermove', { clientY:1800 }); pointer('pointerup');
		expect(send.mock.calls.map(args => (args[0] as {action:number}).action)).toEqual([0,2,1]);
		unmount(); pointer('pointerrawupdate'); expect(send).toHaveBeenCalledTimes(3);
	} finally {Reflect.deleteProperty(HTMLCanvasElement.prototype, 'onpointerrawupdate');}
});
