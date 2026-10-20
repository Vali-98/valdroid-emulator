// @vitest-environment node
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import * as fs from 'node:fs/promises';
import {beforeEach, expect, it, vi} from 'vitest';
import {DeviceTools} from '../../src/host/adb/DeviceTools';
import {runFile} from '../../src/host/session/process';
const mocks = vi.hoisted(() => ({exec: vi.fn(), spawn: vi.fn(), save: vi.fn(), write: vi.fn(), copy: vi.fn()}));
vi.mock('node:child_process', async original => ({...await original<typeof import('node:child_process')>(), execFile: Object.assign(vi.fn(), {[Symbol.for('nodejs.util.promisify.custom')]: mocks.exec}), spawn: mocks.spawn}));
vi.mock('../../src/host/session/process', () => ({runFile: vi.fn()}));
vi.mock('vscode', () => ({Uri: {file: (value: string) => ({fsPath: value})}, window: {showSaveDialog: mocks.save}, workspace: {fs: {writeFile: mocks.write, copy: mocks.copy}}}));
beforeEach(() => {vi.mocked(runFile).mockReset(); mocks.exec.mockReset(); mocks.save.mockReset(); mocks.spawn.mockReset();});
function fixture() {const changed = vi.fn(), error = vi.fn(); return {tools: new DeviceTools('adb', () => 'emulator-5554', changed, error), changed, error};}
it('reads actual settings and validates text scale before invoking ADB', async () => {
	vi.mocked(runFile).mockImplementation(async (_file, args) => args.includes('night') ? 'Night mode: yes' : '1.15');
	const {tools} = fixture(); await tools.action({action: 'settings'});
	expect(tools.state).toMatchObject({darkMode: true, fontScale: 1.15, busy: false});
	await expect(tools.action({action: 'font-scale', value: 99})).rejects.toThrow('85%');
	await tools.action({action: 'dark-mode', value: false});
	expect(runFile).toHaveBeenLastCalledWith('adb', ['-s', 'emulator-5554', 'shell', 'cmd', 'uimode', 'night', 'no']);
});
it('captures binary PNG data and saves only after the user chooses a destination', async () => {
	const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); mocks.exec.mockResolvedValue({stdout: png}); mocks.save.mockResolvedValue({fsPath: '/selected/image.png'});
	await fixture().tools.action({action: 'screenshot'});
	expect(mocks.write).toHaveBeenCalledWith({fsPath: '/selected/image.png'}, png);
	mocks.write.mockClear(); mocks.save.mockResolvedValue(undefined);
	await fixture().tools.action({action: 'screenshot'}); expect(mocks.write).not.toHaveBeenCalled();
});
it('stops only its owned recorder and prompts to save the resulting MP4', async () => {
	const child = Object.assign(new EventEmitter(), {stderr: new PassThrough(), stdout: new PassThrough(), exitCode: null, signalCode: null, kill: vi.fn()});
	mocks.spawn.mockReturnValue(child); mocks.save.mockResolvedValue({fsPath: '/selected/video.mp4'});
	vi.mocked(runFile).mockImplementation(async (_file, args) => {
		if (args.some(arg => arg.includes('kill -2'))) {child.emit('close', 0);}
		if (args[2] === 'pull') {await fs.writeFile(args[4], 'video');}
		return '';
	});
	const {tools} = fixture(); await tools.action({action: 'record-start'});
	expect(tools.state.recordingStartedAt).toBeTypeOf('number');
	await tools.action({action: 'record-stop'});
	expect(tools.state.recordingStartedAt).toBeUndefined();
	expect(mocks.copy).toHaveBeenCalledWith(expect.objectContaining({fsPath: expect.stringContaining('recording.mp4')}), {fsPath: '/selected/video.mp4'}, {overwrite: true});
	expect(vi.mocked(runFile).mock.calls.find(([, args]) => args.some(arg => arg.includes('kill -2')))?.[1].join(' ')).toContain('/proc/$pid/cmdline');
});
