import {createInstrumentation, ReactScanInternals} from 'react-scan/dist/index.mjs';
import {Dimensions, PixelRatio, StatusBar, Platform} from 'react-native';
import {installJSConsole} from './jsConsole';
import {installElementInspector} from './elementInspector';

export function startScan(controlURL) {
  installJSConsole(controlURL);
  let enabled = false;
  let generation = 0;
  let inFlight = false;
  let nextId = 1;
  const ids = new WeakMap();
  const pending = new Map();
  const counts = new WeakMap();
  const MAX_VIEWS = 100;
  const resolveHost = fiber => {
    const state = fiber.stateNode;
    return state?.canonical?.publicInstance ?? state?.canonical ?? state;
  };
  const collect = (fiber, renders) => {
    if (!enabled || renders.every(render => render.phase === 4)) return;
    const stack = [fiber];
    let visited = 0;
    while (stack.length && visited++ < 500 && pending.size < MAX_VIEWS) {
      const node = stack.pop();
      if (!node) continue;
      const host = resolveHost(node);
      if (node.tag === 5 && typeof host?.measureInWindow === 'function') {
        if (!ids.has(host)) ids.set(host, nextId++);
        const count = (counts.get(host) ?? 0) + 1;
        counts.set(host, count);
        pending.set(host, {id: ids.get(host), name: String(renders[0]?.componentName ?? 'View').slice(0, 200), count, didCommit: renders.some(render => render.didCommit) ? 1 : 0});
        continue;
      }
      for (let child = node.child; child; child = child.sibling) stack.push(child);
    }
  };
  const instrumentation = createInstrumentation('valdroid-outline-renders', {
    onCommitStart() {}, onCommitFinish() {}, onActive() {},
    isValidFiber: () => enabled,
    onRender: collect,
    trackChanges: false,
    forceAlwaysTrackRenders: false,
    onError: error => console.warn('[Valdroid Scan]', String(error)),
  });
  ReactScanInternals.instrumentation = instrumentation;
  const inspect = installElementInspector();
  let inspectedId = 0;

  const flush = async () => {
    if (!enabled || inFlight || !pending.size) return;
    inFlight = true;
    const currentGeneration = generation;
    const batch = [...pending];
    pending.clear();
    try {
      const screen = Dimensions.get('screen');
      const windowSize = Dimensions.get('window');
      const density = PixelRatio.get();
      const top = Platform.OS === 'android' && screen.height - windowSize.height >= (StatusBar.currentHeight ?? Infinity) ? StatusBar.currentHeight ?? 0 : 0;
      const outlines = (await Promise.all(batch.map(([host, info]) => new Promise(resolve => {
        let settled = false;
        const timer = setTimeout(() => {settled = true; resolve(null);}, 100);
        try {
          host.measureInWindow((x, y, width, height) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            resolve(width > 0 && height > 0 && [x, y, width, height].every(Number.isFinite) ? {...info, x: x * density, y: (y + top) * density, width: width * density, height: height * density} : null);
          });
        } catch {clearTimeout(timer); resolve(null);}
      })))).filter(Boolean);
      if (enabled && currentGeneration === generation && outlines.length) {
        await fetch(controlURL, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'scan-outlines', width: screen.width * density, height: screen.height * density, outlines})});
      }
    } catch {} finally {inFlight = false;}
  };
  setInterval(flush, 80);
  const poll = async () => {
    try {
      const response = await fetch(controlURL);
      const state = await response.json();
      if (state.inspect && state.inspect.id > inspectedId) {
        inspectedId = state.inspect.id;
        const result = await inspect(state.inspect);
        await fetch(controlURL, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(result)});
      }
      if (enabled !== Boolean(state.enabled)) {
        enabled = Boolean(state.enabled); generation++;
        pending.clear(); instrumentation.isPaused.value = !enabled;
      }
    } catch {
      enabled = false; generation++; pending.clear(); instrumentation.isPaused.value = true;
    }
    setTimeout(poll, 100);
  };
  instrumentation.isPaused.value = true;
  poll();
}
