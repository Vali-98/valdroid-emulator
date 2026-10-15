import { beforeEach, expect, it, vi } from 'vitest';
import { decodeVideoFrame, startVideo } from '../../src/webview/video';
import { mapScreenPoint } from '../../src/webview/input';
import { deferred, MockSocket } from '../helpers';

const decodes: Array<ReturnType<typeof deferred<ImageBitmap>>> = [];
const draw = vi.fn();
const bitmap = () => ({ width: 1080, height: 2400, close: vi.fn() }) as unknown as ImageBitmap;
beforeEach(() => {
	decodes.length = 0; MockSocket.instances = []; vi.stubGlobal('WebSocket', MockSocket);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
	vi.stubGlobal('createImageBitmap', vi.fn(() => {const result = deferred<ImageBitmap>(); decodes.push(result); return result.promise;}));
});
function packet(number = 1) {
	const buffer = new ArrayBuffer(44); const data = new DataView(buffer);
	data.setUint32(0, 0x56444a50); data.setUint32(8,1080,true); data.setUint32(12,2400,true); data.setUint32(20,number,true); data.setUint16(40,0xffd8);
	return buffer;
}

it('parses display metadata and rejects malformed frames', () => {
	expect(decodeVideoFrame(packet()).display).toEqual({ id: 0, width:1080, height:2400, orientation:0 });
	expect(() => decodeVideoFrame(new ArrayBuffer(1))).toThrow('Invalid video frame');
	const invalid = packet(); new DataView(invalid).setUint32(12, 0, true);
	expect(() => decodeVideoFrame(invalid)).toThrow('Invalid video dimensions');
});

it('decodes only the newest pending frame and closes native bitmaps', async () => {
	const image = document.createElement('canvas'); const stop = startVideo('http://localhost',image);
	const socket = MockSocket.instances[0];
	socket.onmessage?.({data:packet(1)}); socket.onmessage?.({data:packet(2)}); socket.onmessage?.({data:packet(3)});
	expect(decodes).toHaveLength(1);
	const first = bitmap(); decodes[0].resolve(first); await Promise.resolve();
	expect(decodes).toHaveLength(2); expect(first.close).toHaveBeenCalledOnce();
	const last = bitmap(); decodes[1].resolve(last); await Promise.resolve();
	expect(draw).toHaveBeenCalledTimes(2); expect(last.close).toHaveBeenCalledOnce();
	expect([image.width, image.height]).toEqual([1080, 2400]);
	image.getBoundingClientRect = () => new DOMRect(0, 0, 1080, 2400);
	expect(mapScreenPoint(image, { id:0, width:1, height:1, orientation:0 }, 540, 1200)).toEqual({x:540,y:1200});
	stop(); expect(image.width).toBe(0);
});

it('does not revive disposed streams when asynchronous decoding finishes', async () => {
	const image = document.createElement('canvas'); const stop = startVideo('http://localhost',image);
	MockSocket.instances[0].onmessage?.({data:packet()}); stop();
	const frame = bitmap(); decodes[0].resolve(frame); await Promise.resolve();
	expect(image.width).toBe(0); expect(draw).not.toHaveBeenCalled(); expect(frame.close).toHaveBeenCalledOnce();
});

it('continues with the next frame after a decoder failure', async () => {
	const stop = startVideo('http://localhost',document.createElement('canvas'));
	const socket = MockSocket.instances[0]; socket.onmessage?.({data:packet()}); socket.onmessage?.({data:packet(2)});
	decodes[0].reject(new Error('corrupt JPEG')); await Promise.resolve();
	expect(decodes).toHaveLength(2);
	decodes[1].resolve(bitmap()); await Promise.resolve(); expect(draw).toHaveBeenCalledOnce(); stop();
});
