import { describe, it, expect, beforeEach, afterEach } from "vitest";

// The module reads `window`/`document`/`Image` off globalThis at call time, so
// a plain node environment works with these stubs.
let idleQueue;
let created;

function installDom({ readyState = "complete", connection = undefined } = {}) {
  idleQueue = [];
  created = [];
  const loadListeners = [];
  globalThis.window = {
    requestIdleCallback: (cb) => idleQueue.push(cb),
    addEventListener: (type, cb) => { if (type === "load") loadListeners.push(cb); },
  };
  globalThis.document = { readyState };
  Object.defineProperty(globalThis, "navigator", {
    value: connection ? { connection } : {},
    configurable: true,
    writable: true,
  });
  globalThis.Image = class {
    constructor() { created.push(this); }
    set src(v) { this._src = v; }
    get src() { return this._src; }
  };
  return {
    fireLoad: () => { globalThis.document.readyState = "complete"; loadListeners.splice(0).forEach((cb) => cb()); },
    loadListenerCount: () => loadListeners.length,
  };
}

function runIdle() {
  idleQueue.splice(0).forEach((cb) => cb());
}

async function loadModule() {
  const mod = await import("../idleImagePrefetch.js");
  mod.__resetIdleImagePrefetch();
  return mod;
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Image;
});

describe("schedulePrefetch", () => {
  it("fetches a queued job on idle with sizes/srcset/src in cache-hit order", async () => {
    installDom();
    const { schedulePrefetch } = await loadModule();
    schedulePrefetch({ src: "a.jpg", srcSet: "a.jpg 400w", sizes: "33vw" });
    expect(created).toHaveLength(0); // nothing before the idle callback
    runIdle();
    expect(created).toHaveLength(1);
    expect(created[0].src).toBe("a.jpg");
    expect(created[0].srcset).toBe("a.jpg 400w");
    expect(created[0].sizes).toBe("33vw");
    expect(created[0].fetchPriority).toBe("low");
  });

  it("does not drain before the window load event fires", async () => {
    const dom = installDom({ readyState: "loading" });
    const { schedulePrefetch } = await loadModule();
    schedulePrefetch({ src: "a.jpg" });
    runIdle();
    expect(created).toHaveLength(0);
    dom.fireLoad();
    runIdle();
    expect(created).toHaveLength(1);
  });

  it("caps concurrent fetches at 3 and starts the rest as they finish", async () => {
    installDom();
    const { schedulePrefetch } = await loadModule();
    ["a", "b", "c", "d", "e"].forEach((n) => schedulePrefetch({ src: `${n}.jpg` }));
    runIdle();
    expect(created).toHaveLength(3);
    created[0].onload();
    runIdle();
    expect(created).toHaveLength(4);
    created[1].onerror(); // errors free a slot too
    runIdle();
    expect(created).toHaveLength(5);
  });

  it("dedupes an already queued, running, or done key", async () => {
    installDom();
    const { schedulePrefetch } = await loadModule();
    schedulePrefetch({ src: "a.jpg" });
    schedulePrefetch({ src: "a.jpg" }); // queued
    runIdle();
    expect(created).toHaveLength(1);
    schedulePrefetch({ src: "a.jpg" }); // running
    runIdle();
    expect(created).toHaveLength(1);
    created[0].onload();
    schedulePrefetch({ src: "a.jpg" }); // done
    runIdle();
    expect(created).toHaveLength(1);
  });

  it("treats the same src with different sizes as distinct jobs", async () => {
    installDom();
    const { schedulePrefetch } = await loadModule();
    schedulePrefetch({ src: "a.jpg", srcSet: "a.jpg 400w", sizes: "33vw" });
    schedulePrefetch({ src: "a.jpg", srcSet: "a.jpg 400w", sizes: "25vw" });
    runIdle();
    expect(created).toHaveLength(2);
    expect(created.map((i) => i.sizes).sort()).toEqual(["25vw", "33vw"]);
  });

  it("cancel dequeues a queued job and allows a later reschedule", async () => {
    installDom();
    const { schedulePrefetch } = await loadModule();
    const cancel = schedulePrefetch({ src: "a.jpg" });
    cancel();
    cancel(); // idempotent
    runIdle();
    expect(created).toHaveLength(0);
    schedulePrefetch({ src: "a.jpg" });
    runIdle();
    expect(created).toHaveLength(1);
  });

  it("cancel of a running job does not abort it, and it still marks done", async () => {
    installDom();
    const { schedulePrefetch } = await loadModule();
    const cancel = schedulePrefetch({ src: "a.jpg" });
    runIdle();
    expect(created).toHaveLength(1);
    cancel();
    created[0].onload();
    schedulePrefetch({ src: "a.jpg" }); // done → no-op
    runIdle();
    expect(created).toHaveLength(1);
  });

  it("does nothing when save-data or a 2g connection is reported", async () => {
    installDom({ connection: { saveData: true } });
    const { schedulePrefetch } = await loadModule();
    schedulePrefetch({ src: "a.jpg" });
    runIdle();
    expect(created).toHaveLength(0);

    installDom({ connection: { effectiveType: "slow-2g" } });
    const mod2 = await loadModule();
    mod2.schedulePrefetch({ src: "b.jpg" });
    runIdle();
    expect(created).toHaveLength(0);
  });
});
