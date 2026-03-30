import { TextEncoder, TextDecoder } from "util";
import "@testing-library/jest-dom";
import { mockResizeObserver, MockIntersectionObserver } from "./test/mocks";

// Avoid "could not find react-redux context" in tests that render components using
// useCachedMediaUrl/useCachedVideoUrl without a Redux Provider. Tests that need the
// real hook (e.g. useCachedMediaUrl.test.tsx) must call jest.unmock() before importing.
jest.mock("./hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url: unknown) => url,
  useCachedVideoUrl: (url: unknown) => url,
}));

// Polyfill TextEncoder/TextDecoder for Jest (required by react-router-dom in Node)
Object.assign(global, { TextEncoder, TextDecoder });

// jsdom may omit innerText; production code uses it for verse parsing (getVerses) and layout.
if (Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText") == null) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    get() {
      return this.textContent ?? "";
    },
    set(value: string) {
      this.textContent = value;
    },
    configurable: true,
  });
}

// jsdom does not implement window.scrollTo
Object.defineProperty(window, "scrollTo", { value: jest.fn(), writable: true });

// ResizeObserver / IntersectionObserver (used by many components)
global.ResizeObserver = jest.fn().mockImplementation(() => mockResizeObserver);
Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});
