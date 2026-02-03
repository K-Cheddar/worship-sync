import { TextEncoder, TextDecoder } from "util";
import "@testing-library/jest-dom";
import { mockResizeObserver, MockIntersectionObserver } from "./test/mocks";

// Polyfill TextEncoder/TextDecoder for Jest (required by react-router-dom in Node)
Object.assign(global, { TextEncoder, TextDecoder });

// jsdom does not implement window.scrollTo
Object.defineProperty(window, "scrollTo", { value: jest.fn(), writable: true });

// ResizeObserver / IntersectionObserver (used by many components)
global.ResizeObserver = jest.fn().mockImplementation(() => mockResizeObserver);
Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});
