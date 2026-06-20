import {flushSync} from "react-dom";
import type {Root} from "react-dom/client";

type CreateRoot = typeof import("react-dom/client").createRoot;

type RuntimeHmrOptions<AppComponent> = {
  container: HTMLElement;
  getRoot: () => Root;
  setRoot: (root: Root) => void;
  getApp: () => AppComponent;
  render: (AppComponent: AppComponent) => void;
};

type ReactRootWithInternals = Root & {
  _internalRoot?: {
    current?: FiberNode;
  };
};

type FiberNode = {
  tag: number;
  key: null | string;
  type: unknown;
  elementType?: unknown;
  memoizedState: unknown;
  child: FiberNode | null;
  sibling: FiberNode | null;
  alternate?: FiberNode | null;
};

type HookNode = {
  memoizedState: unknown;
  baseState?: unknown;
  queue?: {
    lastRenderedState?: unknown;
  } | null;
  next: HookNode | null;
};

type ComponentStateSnapshot = {
  id: string;
  hooks: unknown[];
};

const functionComponentTag = 0;

export function installReactSourceRuntimeHmr<AppComponent>({
  container,
  getRoot,
  setRoot,
  getApp,
  render,
}: RuntimeHmrOptions<AppComponent>) {
  if (!import.meta.hot) {
    return;
  }

  function renderSync(AppComponent = getApp()) {
    flushSync(() => {
      render(AppComponent);
    });
  }

  function remountWithRenderer(nextCreateRoot: CreateRoot) {
    const stateSnapshot = captureComponentState(getRoot());

    getRoot().unmount();
    container.textContent = "";
    setRoot(nextCreateRoot(container));
    renderSync();

    if (restoreComponentState(getRoot(), stateSnapshot)) {
      renderSync();
    }
  }

  import.meta.hot.accept(["react", "react-dom/client"], ([, nextReactDOMClient]) => {
    if (nextReactDOMClient?.createRoot) {
      remountWithRenderer(nextReactDOMClient.createRoot);
      return;
    }

    render(getApp());
  });
}

function captureComponentState(reactRoot: Root): ComponentStateSnapshot[] {
  const fiberRoot = (reactRoot as ReactRootWithInternals)._internalRoot;
  const snapshots: ComponentStateSnapshot[] = [];

  if (!fiberRoot?.current) {
    return snapshots;
  }

  walkFiberTree(fiberRoot.current.child, [], (fiber, path) => {
    if (fiber.tag !== functionComponentTag) {
      return;
    }

    const hooks = readHookStates(fiber.memoizedState);
    if (hooks.length > 0) {
      snapshots.push({id: createFiberId(fiber, path), hooks});
    }
  });

  return snapshots;
}

function restoreComponentState(reactRoot: Root, snapshots: ComponentStateSnapshot[]) {
  const fiberRoot = (reactRoot as ReactRootWithInternals)._internalRoot;
  if (!fiberRoot?.current || snapshots.length === 0) {
    return false;
  }

  const snapshotById = new Map(
    snapshots.map((snapshot) => [snapshot.id, snapshot.hooks]),
  );
  let didRestore = false;

  walkFiberTree(fiberRoot.current.child, [], (fiber, path) => {
    if (fiber.tag !== functionComponentTag) {
      return;
    }

    const hooks = snapshotById.get(createFiberId(fiber, path));
    if (!hooks) {
      return;
    }

    didRestore = writeHookStates(fiber, hooks) || didRestore;
    if (fiber.alternate) {
      writeHookStates(fiber.alternate, hooks);
    }
  });

  return didRestore;
}

function walkFiberTree(
  fiber: FiberNode | null,
  path: number[],
  visit: (fiber: FiberNode, path: number[]) => void,
) {
  let current = fiber;
  let index = 0;

  while (current) {
    const currentPath = [...path, index];
    visit(current, currentPath);

    if (current.child) {
      walkFiberTree(current.child, currentPath, visit);
    }

    current = current.sibling;
    index += 1;
  }
}

function createFiberId(fiber: FiberNode, path: number[]) {
  return [
    path.join("."),
    fiber.key ?? "",
    getComponentName(fiber.elementType ?? fiber.type),
  ].join("|");
}

function getComponentName(type: unknown) {
  if (typeof type === "function") {
    const component = type as {displayName?: string; name?: string};
    return component.displayName ?? component.name ?? "anonymous";
  }

  if (typeof type === "object" && type !== null && "displayName" in type) {
    return String(type.displayName);
  }

  return String(type);
}

function readHookStates(firstHook: unknown) {
  const states: unknown[] = [];
  let hook = firstHook as HookNode | null;

  while (hook) {
    if (isStatefulHook(hook)) {
      states.push(hook.memoizedState);
    }

    hook = hook.next;
  }

  return states;
}

function writeHookStates(fiber: FiberNode, states: unknown[]) {
  let hook = fiber.memoizedState as HookNode | null;
  let stateIndex = 0;
  let didRestore = false;

  while (hook && stateIndex < states.length) {
    if (isStatefulHook(hook)) {
      const state = states[stateIndex];
      hook.memoizedState = state;
      hook.baseState = state;
      if (hook.queue) {
        hook.queue.lastRenderedState = state;
      }
      didRestore = true;
      stateIndex += 1;
    }

    hook = hook.next;
  }

  return didRestore;
}

function isStatefulHook(hook: HookNode) {
  return hook.queue && "lastRenderedState" in hook.queue;
}
