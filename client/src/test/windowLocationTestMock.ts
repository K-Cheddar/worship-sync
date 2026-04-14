/** Captured once per Jest worker (jsdom) before any test replaces `window.location`. */
const initialWindowLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
);

/**
 * jsdom + modern React treat `window.location` as non-redefinable after render if it was
 * installed with `Object.defineProperty` alone; tests that mock `reload` should delete +
 * assign a plain object, then restore via the saved descriptor.
 */
export function mockWindowLocationReload(reload: jest.Mock): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).location;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).location = {
    href: "http://localhost/",
    assign: jest.fn(),
    replace: jest.fn(),
    reload,
  };
}

export function restoreWindowLocation(): void {
  if (initialWindowLocationDescriptor) {
    Object.defineProperty(window, "location", initialWindowLocationDescriptor);
  }
}
