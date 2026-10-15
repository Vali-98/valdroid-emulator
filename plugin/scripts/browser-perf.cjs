// SPDX-License-Identifier: AGPL-3.0-only
const path = require('node:path');
const { chromium } = require('playwright');

function summarize(values) {
  if (!values.length) return { samples: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = percent => sorted[Math.ceil(sorted.length * percent) - 1];
  return { samples: sorted.length, meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: at(1) };
}

async function prepareBrowser(base, screenshot) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const pageErrors = [];
    let receivedWebSocketVideo = false;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('websocket', socket => {
      if (socket.url().endsWith('/video')) socket.on('framereceived', () => { receivedWebSocketVideo = true; });
    });
    await page.goto(`${base}/api/status`);
    await page.setContent('<html><head></head><body style="background:#181818;color:#eee;font:13px sans-serif"><div id="root"></div></body></html>');
    await page.addStyleTag({ path: path.join(__dirname, '../dist/webview.css') });
    await page.evaluate(base => {
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        if (message.type === 'ready') queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'status', state: 'online', status: 'Benchmark connected', serverUrl: base, deviceName: 'Latency fixture',
        } })));
      } });
    }, base);
    await page.addScriptTag({ path: path.join(__dirname, '../dist/webview.js') });
    await page.waitForFunction(() => document.querySelector('#screen')?.width > 0);
    await page.evaluate(() => {
      const image = document.querySelector('#screen');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const state = window.latencyTest = { sequence: -1, pending: null, values: [], start: 0, end: Infinity, stopped: false };
      image.addEventListener('pointerdown', () => {
        state.pending = { sequence: (state.sequence + 1) & 65535, sent: performance.now() };
      }, { capture: true });
      const scan = () => {
        if (state.stopped) return;
        if (image.width) {
          const height = Math.round(320 * image.height / image.width);
          if (canvas.width !== 320 || canvas.height !== height) { canvas.width = 320; canvas.height = height; }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, Math.ceil(canvas.height / 3));
          for (let y = 0; y < pixels.height; y += 2) {
            let sequence = 0, valid = true;
            for (let cell = 0; cell < 20; cell++) {
              const x = Math.floor((.1 + .8 * (cell + .5) / 20) * canvas.width);
              const index = (y * pixels.width + x) * 4;
              const [r, g, b] = pixels.data.subarray(index, index + 3);
              const green = r < 100 && g > 150 && b < 100, blue = r < 100 && b > 150 && g < 100;
              if ((!green && !blue) || (cell < 4 && green !== (cell % 2 === 0))) { valid = false; break; }
              if (cell >= 4 && green) sequence |= 1 << (cell - 4);
            }
            if (!valid) continue;
            state.sequence = sequence;
            if (state.pending?.sequence === sequence) {
              const sent = performance.timeOrigin + state.pending.sent;
              if (sent >= state.start && sent < state.end) state.values.push(performance.now() - state.pending.sent);
              state.pending = null;
            }
            break;
          }
        }
        requestAnimationFrame(scan);
      };
      requestAnimationFrame(scan);
    });
    await page.waitForFunction(() => window.latencyTest.sequence >= 0, undefined, { timeout: 5000 });
    return {
      async measure(start, duration) {
        await page.evaluate(({ start, duration }) => { window.latencyTest.start = start; window.latencyTest.end = start + duration; }, { start, duration });
        await new Promise(resolve => setTimeout(resolve, Math.max(0, start - Date.now())));
        while (Date.now() + 300 < start + duration) {
          const box = await page.locator('#screen').boundingBox();
          if (!box) throw new Error('Emulator image is not visible');
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForFunction(() => window.latencyTest.pending === null, undefined, { timeout: 2000 });
          await page.waitForTimeout(400);
        }
        const values = await page.evaluate(() => { window.latencyTest.stopped = true; return window.latencyTest.values; });
        if (pageErrors.length) throw new Error(`Webview errors: ${pageErrors.join('; ')}`);
        if (!values.length) throw new Error('No browser touch responses were measured');
        if (screenshot) await page.screenshot({ path: screenshot });
        const viewports = [];
        for (const viewport of [{ width:1000, height:900 }, { width:360, height:640 }]) {
          await page.setViewportSize(viewport); await page.waitForTimeout(100);
          const geometry = await page.evaluate(() => {
            const screen = document.querySelector('#screen'), rail = document.querySelector('.device-rail');
            const box = screen.getBoundingClientRect(), side = rail?.getBoundingClientRect();
            const scale = Math.min(box.width / screen.width, box.height / screen.height);
            const width = screen.width * scale, height = screen.height * scale;
            const left = box.left + (box.width - width) / 2, top = box.top + (box.height - height) / 2;
            const pixels = screen.getContext('2d').getImageData(0, 0, screen.width, screen.height).data;
            let colorful = 0;
            for (let i = 0; i < pixels.length; i += 400) if (Math.max(pixels[i],pixels[i+1],pixels[i+2]) - Math.min(pixels[i],pixels[i+1],pixels[i+2]) > 100) colorful++;
            return { width, height, fits: left >= 0 && top >= 0 && left + width <= innerWidth + 1 && top + height <= innerHeight + 1,
              overlapsControls: !!side && left < side.right && left + width > side.left && top < side.bottom && top + height > side.top,
              colorfulSamples: colorful };
          });
          if (!geometry.fits || geometry.overlapsControls || !geometry.colorfulSamples) throw new Error(`Invalid emulator canvas at ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`);
          viewports.push({ viewport, screen:geometry });
        }
        return { scope: 'Actual React input handler to observed image pixels in headless Chromium; excludes physical display scanout and VS Code workbench overhead.',
          transport: receivedWebSocketVideo ? 'websocket' : 'mjpeg-fallback', touchToBrowserImage: summarize(values), viewports };
      },
      close: () => browser.close(),
    };
  } catch (error) { await browser.close(); throw error; }
}

module.exports = { prepareBrowser, summarize };
