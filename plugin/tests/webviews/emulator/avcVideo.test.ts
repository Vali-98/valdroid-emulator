import { beforeEach, expect, it, vi } from 'vitest';
import { parseAVCPacket, startAVCVideo } from '../../../src/webviews/emulator/media/avcVideo';

class Socket {
 static instance: Socket;
 onmessage: ((event: {data: string | ArrayBuffer}) => void) | null = null;
 onerror: (() => void) | null = null;
 onclose: (() => void) | null = null;
 close = vi.fn();
 constructor() {Socket.instance = this;}
}
let decoder: Decoder;
class Decoder {
 static isConfigSupported = vi.fn(async () => ({supported:true}));
 state = 'unconfigured'; decodeQueueSize = 0;
 configure = vi.fn(() => {this.state = 'configured';});
 decode = vi.fn(); close = vi.fn(() => {this.state = 'closed';});
 constructor(readonly callbacks: VideoDecoderInit) {decoder = this;}
}
const draw = vi.fn();
let paint: FrameRequestCallback;
beforeEach(() => {
 vi.clearAllMocks();
 vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('VideoDecoder', Decoder);
 vi.stubGlobal('EncodedVideoChunk', class {constructor(readonly data: EncodedVideoChunkInit) {}});
 vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {paint = callback; return 1;});
 vi.stubGlobal('cancelAnimationFrame', vi.fn());
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw} as unknown as CanvasRenderingContext2D);
});
function packet(timestamp=1,key=true) {
 const buffer=new ArrayBuffer(38),view=new DataView(buffer);
 view.setUint32(0,0x56444156);view.setUint8(4,key?1:0);view.setBigUint64(8,BigInt(timestamp),true);view.setBigUint64(16,BigInt(Date.now()),true);
 new Uint8Array(buffer,32).set([0,0,0,1,key?0x65:0x41,1]);return buffer;
}
async function configure() {
 Socket.instance.onmessage?.({data:JSON.stringify({type:'config',codec:'avc1.42C01E',display:{id:0,width:1080,height:2400,orientation:0}})});
 await Promise.resolve();await Promise.resolve();
}
function frame(timestamp: number) {return {timestamp,displayWidth:1080,displayHeight:2400,close:vi.fn()} as unknown as VideoFrame;}
it('validates binary packets',()=>{
 expect(parseAVCPacket(packet(25)).timestamp).toBe(25);
 expect(()=>parseAVCPacket(new ArrayBuffer(8))).toThrow();
 const invalid=packet();new DataView(invalid).setUint32(0,0);expect(()=>parseAVCPacket(invalid)).toThrow();
});
it('decodes references but paints only the newest frame and releases both',async()=>{
 const stop=startAVCVideo('http://localhost',document.createElement('canvas'),vi.fn(),vi.fn());
 await configure();Socket.instance.onmessage?.({data:packet(1)});Socket.instance.onmessage?.({data:packet(2,false)});
 expect(decoder.decode).toHaveBeenCalledTimes(2);
 const first=frame(1),second=frame(2);decoder.callbacks.output(first);decoder.callbacks.output(second);
 expect(first.close).toHaveBeenCalledOnce();expect(draw).not.toHaveBeenCalled();paint(0);
 expect(draw).toHaveBeenCalledTimes(1);expect(second.close).toHaveBeenCalledOnce();stop();expect(decoder.close).toHaveBeenCalledOnce();
});
it('reports failure rather than queueing unbounded dependent frames',async()=>{
 const onError=vi.fn();const stop=startAVCVideo('http://localhost',document.createElement('canvas'),vi.fn(),onError);
 await configure();decoder.decodeQueueSize=12;Socket.instance.onmessage?.({data:packet()});
 expect(onError).toHaveBeenCalledOnce();expect(decoder.decode).not.toHaveBeenCalled();expect(Socket.instance.close).toHaveBeenCalledOnce();stop();
});
it('does not configure after disposal during capability detection',async()=>{
 let resolve!: (value: {supported:boolean})=>void;
 Decoder.isConfigSupported.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const stop=startAVCVideo('http://localhost',document.createElement('canvas'),vi.fn(),vi.fn());
 const pending=configure();stop();resolve({supported:true});await pending;
 expect(Socket.instance.close).toHaveBeenCalledOnce();
});
it('reports unsupported AVC support and closes the connection',async()=>{
 Decoder.isConfigSupported.mockResolvedValueOnce({supported:false});
 const onError=vi.fn();const stop=startAVCVideo('http://localhost',document.createElement('canvas'),vi.fn(),onError);
 await configure();
 expect(onError).toHaveBeenCalledWith('WebCodecs does not support avc1.42C01E');
 expect(Socket.instance.close).toHaveBeenCalledOnce();stop();
});
it('reports a disconnect and releases pending decoded frames',async()=>{
 const onError=vi.fn();const stop=startAVCVideo('http://localhost',document.createElement('canvas'),vi.fn(),onError);
 await configure();Socket.instance.onmessage?.({data:packet(1)});
 const pending=frame(1);decoder.callbacks.output(pending);Socket.instance.onclose?.();
 expect(onError).toHaveBeenCalledWith('Direct AVC stream disconnected');
 expect(pending.close).toHaveBeenCalledOnce();expect(decoder.close).toHaveBeenCalledOnce();stop();
});
