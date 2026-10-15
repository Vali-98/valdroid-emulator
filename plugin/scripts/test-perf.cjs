// SPDX-License-Identifier: AGPL-3.0-only
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { parseArgs } = require('node:util');

const root = path.resolve(__dirname, '../..');
const serverRoot = path.join(root, 'control-server');

async function main() {
  const { values } = parseArgs({ options: {
    duration: { type: 'string', default: '30s' }, warmup: { type: 'string', default: '3s' },
    fps: { type: 'string', default: '60' }, width: { type: 'string', default: '1080' }, height: { type: 'string', default: '2400' },
    transport: { type: 'string', default: 'websocket' }, 'go-tags': { type: 'string', default: '' },
    replay: { type: 'string' }, device: { type: 'string' }, adb: { type: 'string', default: 'adb' },
    'server-binary': { type: 'string' }, output: { type: 'string' }, json: { type: 'boolean' },
    'no-assert': { type: 'boolean' }, help: { type: 'boolean' },
    browser: { type: 'boolean' }, screenshot: { type: 'string' },
  } });
  if (values.help) {
    console.log('npm run test:perf -- [--duration 30s] [--transport websocket|mjpeg] [--go-tags turbojpeg] [--device emulator-5554] [--browser] [--screenshot image.png] [--output report.json] [--json] [--no-assert]\nDefault: isolated AVC replay. --device installs a temporary touch fixture on a dedicated emulator; stop its existing Valdroid stream first. --browser measures the actual React webview (install Chromium with npx playwright install chromium). Requires Go/C toolchain; replay generation also requires ffmpeg/libx264, and live tests require the Android SDK/JDK and bash.');
    return;
  }
  if (!['websocket', 'mjpeg'].includes(values.transport)) throw new Error('transport must be websocket or mjpeg');
  if (values.device && values.replay) throw new Error('Choose a dedicated device or replay, not both');
  if (values.browser && !values.device) throw new Error('--browser requires a dedicated --device');
  for (const name of ['fps', 'width', 'height']) {
    if (!/^[1-9]\d*$/.test(values[name]) || Number(values[name]) > (name === 'fps' ? 240 : 16384)) throw new Error(`Invalid ${name}`);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'valdroid-perf-'));
  const children = new Set();
  let server, browser, fixtureInstalled = false, foreground;
  let interrupted = false;
  const interrupt = () => { interrupted = true; for (const child of children) child.kill('SIGTERM'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const run = (command, args, options = {}) => new Promise((resolve, reject) => {
    if (interrupted && !options.cleanup) { reject(new Error('Performance test canceled')); return; }
    const child = spawn(command, args, { cwd: options.cwd || serverRoot, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
    child.once('error', reject);
    child.once('close', code => {
      children.delete(child);
      if (code === 0 || (options.report && code === 1 && stdout.trim().startsWith('{'))) {
        if (code !== 0) { console.error(stderr.trim()); process.exitCode = 1; }
        resolve(stdout);
      }
      else reject(new Error(`${command} failed (${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
  const adb = (args, cleanup = false) => run(values.adb, ['-s', values.device, ...args], { cleanup });
  try {
    const extension = process.platform === 'win32' ? '.exe' : '';
    const serverBinary = values['server-binary'] ? path.resolve(values['server-binary']) : path.join(work, `control-server${extension}`);
    const probeBinary = path.join(work, `perfprobe${extension}`);
    console.error('Building standalone benchmark utility and native server...');
    await run('go', ['build', '-o', probeBinary, './tools/perfprobe']);
    const timing = JSON.parse(await run(probeBinary, ['--describe', '--duration', values.duration, '--warmup', values.warmup]));
    if (values.browser) await run(process.execPath, [path.join(root, 'plugin/esbuild.js'), '--production'], { cwd: path.join(root, 'plugin') });
    if (!values['server-binary']) await run('go', ['build', '-tags', values['go-tags'], '-o', serverBinary, '.'], { env: { CGO_ENABLED: '1' } });
    let fixture = values.replay ? path.resolve(values.replay) : path.join(work, 'replay.h264');
    if (values.device) {
      const existing = await adb(['shell', 'pm', 'list', 'packages', 'dev.valdroid.frameclock']);
      if (existing.includes('package:dev.valdroid.frameclock')) throw new Error('The benchmark fixture already exists on this device. Remove it explicitly before running; existing apps will not be overwritten.');
      const reverse = await adb(['reverse', '--list']);
      if (reverse.includes('localabstract:screen-sharing-agent')) throw new Error('Stop the existing Valdroid stream on this dedicated device before testing.');
      const activities = await adb(['shell', 'dumpsys', 'activity', 'activities']);
      foreground = activities.match(/topResumedActivity=.*?\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/)?.[1];
      fixture = path.join(work, 'frame-clock.apk');
      console.error(`Preparing temporary touch fixture on ${values.device}...`);
      await run('bash', ['tools/frame-clock/build.sh', fixture]);
      await adb(['install', '-t', fixture]); fixtureInstalled = true;
      await adb(['shell', 'am', 'start', '-W', '-n', 'dev.valdroid.frameclock/.FrameClock']);
    } else if (!values.replay) {
      console.error('Generating deterministic AVC replay fixture...');
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${values.width}x${values.height}:rate=${values.fps}`,
        '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', values.fps, '-bf', '0', '-b:v', '10M',
        '-pix_fmt', 'yuv420p', '-bsf:v', 'h264_metadata=aud=insert', '-f', 'h264', '-y', fixture]);
    }
    const serverArgs = ['--http', '127.0.0.1:0', '--socket', '127.0.0.1:0', '--announce-listeners'];
    if (values.device) serverArgs.push('--device-serial', values.device, '--adb', values.adb, '--dist-dir', path.join(root, 'plugin/bundle', `${process.platform}-${process.arch}`));
    server = spawn(serverBinary, serverArgs, { cwd: serverRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(server);
    let serverLog = '';
    server.stderr.on('data', data => { serverLog = (serverLog + data).slice(-16000); });
    const endpoints = await new Promise((resolve, reject) => {
      const lines = createInterface({ input: server.stdout });
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${serverLog}`)), 10000);
      const fail = error => { clearTimeout(timer); reject(error); };
      server.once('error', fail); server.once('exit', code => fail(new Error(`Server exited (${code}): ${serverLog}`)));
      lines.on('line', line => {
        let message; try { message = JSON.parse(line); } catch { return; }
        if (message.type === 'server-listening') { clearTimeout(timer); lines.close(); server.stdout.resume(); resolve(message); }
      });
    });
    const deadline = Date.now() + 120000;
    while (true) {
      if (interrupted) throw new Error('Performance test canceled');
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Server exited: ${serverLog}`);
      const response = await fetch(`${endpoints.httpUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
      const status = await response.json();
      if (status.agentError) throw new Error(status.agentError);
      if (!values.device || (status.videoConnected && status.controlConnected)) break;
      if (Date.now() > deadline) throw new Error(`Agent readiness timed out: ${serverLog}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const args = ['--url', endpoints.httpUrl, '--agent', endpoints.socketAddress, '--pid', String(server.pid),
      '--duration', values.duration, '--warmup', values.warmup, '--fps', values.fps, '--width', values.width, '--height', values.height, '--transport', values.transport];
    if (values.device && !values.browser) args.push('--touch-latency'); else if (!values.device) args.push('--replay', fixture);
    if (!values['no-assert']) args.push('--assert-target');
    console.error(`Measuring ${values.device ? 'live input/video' : 'replay'} via ${values.transport}: ${values.warmup} warmup + ${values.duration} sample...`);
    if (values.browser) {
      console.error('Opening actual React webview in headless Chromium...');
      browser = await require('./browser-perf.cjs').prepareBrowser(endpoints.httpUrl, values.screenshot ? path.resolve(values.screenshot) : undefined);
    }
    const start = Date.now() + timing.warmupMs + 250;
    args.push('--start-at', String(start));
    const [rawReport, browserReport] = await Promise.all([run(probeBinary, args, { report: true }), browser ? browser.measure(start, timing.durationMs) : undefined]);
    const report = JSON.parse(rawReport);
    if (browserReport) report.browser = browserReport;
    if (values.output) fs.writeFileSync(path.resolve(values.output), JSON.stringify(report, null, 2) + '\n');
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`FPS: ${report.video.fps.toFixed(2)} | frame gap p95/p99: ${report.video.receiveIntervals.p95Ms.toFixed(2)}/${report.video.receiveIntervals.p99Ms.toFixed(2)} ms`);
      console.log(`Server CPU: ${report.resources.cpuPercentOneCore.mean.toFixed(2)}% (100% = one core) | RAM mean/peak: ${report.resources.rssMiB.mean.toFixed(2)}/${report.resources.rssMiB.max.toFixed(2)} MiB`);
      if (report.video.replayToReceive.samples) console.log(`Replay send to receive mean/p95: ${report.video.replayToReceive.meanMs.toFixed(2)}/${report.video.replayToReceive.p95Ms.toFixed(2)} ms`);
      if (report.touch) {
        console.log(`Touch to received response mean/p95: ${report.touch.touchToReceivedFrame.meanMs.toFixed(2)}/${report.touch.touchToReceivedFrame.p95Ms.toFixed(2)} ms (${report.touch.touchToReceivedFrame.samples} taps)`);
        console.log(`Input round trip mean/p95: ${report.touch.inputRoundTrip.meanMs.toFixed(2)}/${report.touch.inputRoundTrip.p95Ms.toFixed(2)} ms | server forwarding mean: ${report.touch.serverForward.meanMs.toFixed(2)} ms`);
      }
      if (report.browser) console.log(`React input to browser image mean/p95: ${report.browser.touchToBrowserImage.meanMs.toFixed(2)}/${report.browser.touchToBrowserImage.p95Ms.toFixed(2)} ms (${report.browser.touchToBrowserImage.samples} taps)`);
      console.log('Server CPU/RAM exclude the emulator and probes. Go latency excludes browser/display; browser latency excludes physical scanout and VS Code overhead. Use --json or --output for the full report.');
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    for (const child of children) {
      if (child === server || child.exitCode !== null || child.signalCode !== null) continue;
      const exited = new Promise(resolve => child.once('close', resolve));
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.kill('SIGTERM'); await exited; clearTimeout(timer);
    }
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      const timer = setTimeout(() => server.kill('SIGKILL'), 8000);
      server.kill('SIGTERM'); await exited; clearTimeout(timer);
    }
    if (values.device && server?.pid) await adb(['reverse', '--remove', 'localabstract:screen-sharing-agent'], true).catch(() => undefined);
    if (fixtureInstalled) {
      await adb(['uninstall', 'dev.valdroid.frameclock'], true).catch(error => console.error(`Fixture cleanup: ${error.message}`));
      await adb(foreground ? ['shell', 'am', 'start', '-n', foreground] : ['shell', 'input', 'keyevent', '3'], true).catch(() => undefined);
    }
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
