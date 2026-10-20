import {Dimensions} from 'react-native';
import {serializeJSValue} from './jsConsole';

const hostInstance = fiber => fiber?.stateNode?.canonical?.publicInstance ?? fiber?.stateNode?.canonical ?? fiber?.stateNode;
const nameFor = fiber => {
  const type = fiber.type;
  return type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? (typeof type === 'string' ? type : null);
};

export function createHierarchy(getRoots, topInset) {
  const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ids = new WeakMap();
  let nextID = 0, lastSnapshot = 0, version = -1, active = false, hovered;
  let fibers = new Map();
  const getID = fiber => {
    const id = ids.get(fiber) ?? (fiber.alternate && ids.get(fiber.alternate)) ?? `${epoch}:${++nextID}`;
    ids.set(fiber, id);
    if (fiber.alternate) ids.set(fiber.alternate, id);
    return id;
  };
  const highlight = async id => {
    const screen = Dimensions.get('screen');
    const result = {type: 'hierarchy-highlight', id, width: screen.width, height: screen.height};
    const queue = [fibers.get(id)];
    for (let visited = 0; queue.length && visited < 2000; visited++) {
      const fiber = queue.pop();
      if (!fiber) continue;
      if (fiber.tag === 22 && fiber.memoizedState !== null) continue;
      const host = hostInstance(fiber);
      if (fiber.tag === 5 && typeof host?.measureInWindow === 'function') {
        return new Promise(resolve => {
          const timer = setTimeout(() => resolve(result), 150);
          try {host.measureInWindow((x, y, width, height) => {
            clearTimeout(timer);
            if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) result.frame = {x, y: y + topInset(), width, height};
            resolve(result);
          });} catch {clearTimeout(timer); resolve(result);}
        });
      }
      const children = [];
      for (let child = fiber.child; child; child = child.sibling) children.push(child);
      queue.push(...children.reverse());
    }
    return result;
  };
  const update = async control => {
    if (!control?.active) {
      const clear = active || hovered;
      active = false; hovered = undefined; fibers.clear(); lastSnapshot = 0;
      const screen = Dimensions.get('screen');
      return clear ? [{type: 'hierarchy-highlight', width: screen.width, height: screen.height}] : [];
    }
    const events = [];
    if (!active || version !== control.version || Date.now() - lastSnapshot >= 1000) {
      fibers = new Map();
      const nodes = [], queue = [...getRoots()].reverse().map(root => ({fiber: root.current, parentId: undefined}));
      const query = String(control.query ?? '').toLocaleLowerCase();
      const candidates = new Map(), included = new Set();
      let visited = 0, resultLimited = false;
      while (queue.length && visited++ < 20000 && (query || nodes.length < 3000)) {
        const {fiber, parentId} = queue.pop();
        if (!fiber || fiber.tag === 22 && fiber.memoizedState !== null) continue;
        const name = nameFor(fiber);
        let parent = parentId;
        if (name) {
          const id = getID(fiber);
          const node = {id, ...(parentId ? {parentId} : {}), name: String(name).slice(0, 100)};
          if (query) {
            candidates.set(id, {node, fiber});
            if (node.name.toLocaleLowerCase().includes(query)) {
              const path = [];
              let ancestor = node;
              while (ancestor && !included.has(ancestor.id)) {path.push(ancestor.id); ancestor = candidates.get(ancestor.parentId)?.node;}
              if (included.size + path.length <= 3000) {for (const item of path) included.add(item);} else resultLimited = true;
            }
          } else {nodes.push(node); fibers.set(id, fiber);}
          parent = id;
        }
        const children = [];
        for (let child = fiber.child; child; child = child.sibling) children.push({fiber: child, parentId: parent});
        queue.push(...children.reverse());
      }
      if (query) for (const [id, {node, fiber}] of candidates) {if (included.has(id)) {nodes.push(node); fibers.set(id, fiber);}}
      const selected = fibers.get(control.selectedId);
      let props = selected ? serializeJSValue(selected.memoizedProps) : undefined;
      if (props && JSON.stringify(props).length > 64000) props = {type: 'limit', preview: '[Props snapshot exceeds size limit]', truncated: true};
      events.push({type: 'hierarchy-snapshot', nodes, version: control.version, truncated: Boolean(queue.length) || resultLimited,
        ...(selected ? {selectedId: control.selectedId, props} : {}),
        ...(!nodes.length ? {error: query && visited > 1 ? 'No matching components.' : 'Waiting for a mounted React app…'} : {})});
      lastSnapshot = Date.now(); version = control.version; active = true;
    }
    if (hovered !== control.hoveredId || control.hoveredId && events.length) {
      hovered = control.hoveredId;
      events.push(await highlight(hovered));
    }
    return events;
  };
  return {getID, update};
}
