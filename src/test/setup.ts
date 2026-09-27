import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

/**
 * jsdom implements no ResizeObserver, and Radix primitives that measure a
 * node (@radix-ui/react-use-size, behind Switch/Checkbox and friends) call it
 * on mount. The throw escapes React's commit phase, so it lands as an
 * UNHANDLED error rather than a test failure: every assertion in the file
 * passes and vitest still fails the file, with a stack pointing into
 * node_modules. Two files sat like that, exiting 1 on a fully green suite.
 *
 * Same reason and same shape as the matchMedia stub above — a browser API
 * jsdom lacks, filled in so component code can mount. It reports nothing, so
 * a test that needs real measurements must stub it itself; nothing in this
 * suite does.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  configurable: true,
  value: ResizeObserverStub,
});
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;
