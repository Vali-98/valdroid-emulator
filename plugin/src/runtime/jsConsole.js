export function serializeJSValue(value, depth = 0, seen = new WeakSet(), budget = {nodes: 0, chars: 0}) {
  if (++budget.nodes > 500) return {type: 'limit', preview: '[Value limit]', truncated: true};
  if (value === null) return {type: 'null', preview: 'null'};
  const type = typeof value;
  if (type === 'string') {
    const limit = Math.min(4000, Math.max(0, 32000 - budget.chars));
    const preview = value.slice(0, limit); budget.chars += preview.length;
    return {type, preview, truncated: value.length > limit};
  }
  if (type !== 'object') return {type, preview: (type === 'function' ? `[Function ${value.name || 'anonymous'}]` : String(value)).slice(0, 4000)};
  if (seen.has(value)) return {type: 'reference', preview: '[Circular / shared reference]'};
  seen.add(value);
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor');
    const name = typeof constructor?.value === 'function' ? constructor.value.name || 'Object' : 'Object';
    const preview = (array ? `Array(${value.length})` : value instanceof Error ? `${value.name}: ${value.message}` : value instanceof Date ? String(value) : name).slice(0, 4000);
    if (depth >= 6) return {type: array ? 'array' : 'object', preview, truncated: true};
    const accessor = Symbol();
    let pairs;
    if (value instanceof Map || value instanceof Set) {
      pairs = [];
      for (const item of value) {if (pairs.length >= 100) break; pairs.push([String(pairs.length), value instanceof Map ? {key: item[0], value: item[1]} : item]);}
    }
    else {
      const keys = Object.getOwnPropertyNames(value).filter(key => !array || key !== 'length').slice(0, 100);
      pairs = keys.map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return [key, descriptor && 'value' in descriptor ? descriptor.value : accessor];
      });
    }
    const entries = [];
    for (const [key, item] of pairs) {
      if (budget.nodes >= 500) break;
      if (item === accessor) budget.nodes++;
      entries.push({key: String(key).slice(0, 1000), value: item === accessor ? {type: 'accessor', preview: '[Getter / Setter]'} : serializeJSValue(item, depth + 1, seen, budget)});
    }
    return {type: array ? 'array' : 'object', preview, entries, truncated: budget.nodes >= 500 || (array ? value.length > 100 : value instanceof Map || value instanceof Set ? value.size > 100 : Object.getOwnPropertyNames(value).length > 100)};
  } catch {return {type: 'unavailable', preview: '[Unable to inspect value]'};}
}

export function installJSConsole(controlURL) {
  if (globalThis.__valdroidJSConsole) {globalThis.__valdroidJSConsole.url = controlURL; return;}
  const state = {url: controlURL};
  globalThis.__valdroidJSConsole = state;
  const queue = [];
  let queuedSize = 0;
  let nested = false, inFlight = false;
  for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
    const original = console[level];
    console[level] = function(...args) {
      if (nested) return original?.apply(this, args);
      nested = true;
      try {
        try {
          const seen = new WeakSet(), budget = {nodes: 0, chars: 0};
          const record = {level, time: Date.now(), args: args.slice(0, 20).map(value => serializeJSValue(value, 0, seen, budget)), stack: String(new Error().stack || '').split('\n').slice(2, 22).join('\n').slice(0, 16000)};
          const size = JSON.stringify(record).length;
          queue.push({record, size}); queuedSize += size;
          while (queue.length > 500 || queuedSize > 1024 * 1024) queuedSize -= queue.shift().size;
        } catch {}
        return original?.apply(this, args);
      } finally {nested = false;}
    };
  }
  setInterval(async () => {
    if (inFlight || !queue.length) return;
    inFlight = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timeout = setTimeout(() => controller?.abort(), 2000);
    try {
      const batch = queue.splice(0, 20);
      queuedSize -= batch.reduce((sum, item) => sum + item.size, 0);
      await fetch(state.url, {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller?.signal, body: JSON.stringify({type: 'js-logs', records: batch.map(item => item.record)})});
    } catch {} finally {clearTimeout(timeout); inFlight = false;}
  }, 100);
}
