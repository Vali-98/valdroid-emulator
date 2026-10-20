import {Dimensions, Platform, StatusBar} from 'react-native';

const hostInstance = fiber => fiber?.stateNode?.canonical?.publicInstance ?? fiber?.stateNode?.canonical ?? fiber?.stateNode;
export function inspectorTopInset() {
  const screen = Dimensions.get('screen');
  const window = Dimensions.get('window');
  return Platform.OS === 'android' && screen.height - window.height >= (StatusBar.currentHeight ?? Infinity) ? StatusBar.currentHeight ?? 0 : 0;
}

// Keep our own mounted-root registry: Scan's minimal hook doesn't implement getFiberRoots.
// Chain the existing callback so Scan and any attached React DevTools keep working.
export function installElementInspector() {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const roots = new Map();
  if (hook) {
    const previous = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function(id, root, ...args) {
      try {
        if (!roots.has(id)) roots.set(id, new Set());
        if (root.current?.child) roots.get(id).add(root); else roots.get(id).delete(root);
      } finally {previous?.call(this, id, root, ...args);}
    };
  }
  return async request => {
    const screen = Dimensions.get('screen');
    const result = {type: 'inspector-result', id: request.id, width: screen.width, height: screen.height, elements: []};
    try {
      if (!hook) throw new Error('React inspector hook is unavailable. Restart the app with Valdroid.');
      // Last mounted roots first, so a modal is inspected before the underlying app.
      for (const [id, renderer] of [...hook.renderers].reverse()) {
        const inspector = renderer.rendererConfig ?? renderer;
        if (typeof inspector.getInspectorDataForViewAtPoint !== 'function') continue;
        const mounted = roots.get(id) ?? hook.getFiberRoots?.(id) ?? [];
        for (const root of [...mounted].reverse()) {
          const queue = [root.current];
          let host;
          for (let visited = 0; queue.length && visited < 2000; visited++) {
            const fiber = queue.pop();
            if (fiber?.tag === 5 && typeof hostInstance(fiber)?.measureInWindow === 'function') {host = hostInstance(fiber); break;}
            const children = [];
            for (let child = fiber?.child; child; child = child.sibling) children.push(child);
            queue.push(...children.reverse());
          }
          if (!host) continue;
          const top = inspectorTopInset();
          const data = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Native view inspection timed out.')), 1200);
            host.measureInWindow((x, y, width, height) => {
              const px = request.x * screen.width - x;
              const py = request.y * screen.height - top - y;
              if (px < 0 || py < 0 || px >= width || py >= height) {clearTimeout(timer); resolve(null); return;}
              try {inspector.getInspectorDataForViewAtPoint(host, px, py, value => {clearTimeout(timer); resolve(value);});}
              catch (error) {clearTimeout(timer); reject(error);}
            });
          });
          if (!data?.hierarchy?.length || !data.frame?.width || !data.frame?.height) continue;
          result.frame = {x: data.frame.left, y: data.frame.top + top, width: data.frame.width, height: data.frame.height};
          const seen = new Set();
          let fiber = data.closestInstance;
          while (fiber && !seen.has(fiber) && result.elements.length < 10) {
            seen.add(fiber);
            const type = fiber.type;
            const name = type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? (typeof type === 'string' ? type : null);
            if (name) {
              const source = fiber._debugSource;
              result.elements.push({name: String(name).slice(0, 200),
                ...(source?.fileName ? {source: {fileName: source.fileName, lineNumber: source.lineNumber, columnNumber: source.columnNumber ?? 1}} : {}),
                ...(fiber._debugStack?.stack ? {stack: String(fiber._debugStack.stack).slice(0, 16000)} : {})});
            }
            fiber = fiber._debugOwner ?? fiber.return;
          }
          if (!result.elements.length) result.elements = data.hierarchy.slice(-10).reverse().map(item => ({name: String(item.name ?? 'Component').slice(0, 200)}));
          return result;
        }
      }
      result.error = 'No React component at this position.';
    } catch (error) {result.error = String(error.message ?? error).slice(0, 500);}
    return result;
  };
}
