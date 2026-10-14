/* eslint-disable testing-library/no-node-access -- Entry-point tests inspect the initial HTML canvas before React mounts. */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

const mockOperator = jest.fn();
const mockPublic = jest.fn();
const mockCapture = jest.fn();
const mockBreadcrumb = jest.fn();
const mockScope = { setTag: jest.fn(), setContext: jest.fn() };
let root: Root;
let container: HTMLElement;

const deferred = () => {
  let resolve!: (value: { default: () => React.JSX.Element }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ default: () => React.JSX.Element }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const loaded = { default: () => <div>Output content</div> };
const start = async (url: string) => {
  window.history.replaceState({}, "", url);
  await act(async () => { await import("./main"); });
};
const expectEmpty = () => {
  expect(container).toBeEmptyDOMElement();
  for (const element of [document.documentElement, document.body, container]) {
    expect(element.style.backgroundColor).toBe("transparent");
  }
};

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.clearAllMocks();
  sessionStorage.clear();
  // Use the actual initial document, including its pre-React canvas styles.
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const initialDocument = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = initialDocument.body.innerHTML;
  document.body.setAttribute("style", initialDocument.body.getAttribute("style") ?? "");
  document.documentElement.setAttribute("style", html.match(/<html[^>]*style="([^"]*)"/)?.[1] ?? "");
  container = document.getElementById("root")!;
  root = createRoot(container);
  jest.doMock("react", () => React);
  jest.doMock("react-dom/client", () => ({ __esModule: true, default: { createRoot: () => root } }));
  jest.doMock("./utils/consoleLogForwarder", () => ({ initConsoleLogForwarder: jest.fn() }));
  jest.doMock("./serviceWorkerRegistration", () => ({ register: jest.fn() }));
  jest.doMock("./reportWebVitals", () => ({ __esModule: true, default: jest.fn() }));
  jest.doMock("@sentry/react", () => ({
    captureException: mockCapture,
    addBreadcrumb: mockBreadcrumb,
    withScope: (callback: (scope: typeof mockScope) => void) => callback(mockScope),
  }));
  jest.doMock("./utils/bootstrapRecovery", () => {
    const actual = jest.requireActual<typeof import("./utils/bootstrapRecovery")>("./utils/bootstrapRecovery");
    return {
      ...actual,
      // Control only the network boundary; run the production selection/retry ladder.
      loadSelectedBootstrapModule: (isPublic: boolean, _loaders: unknown, options: object) =>
        actual.loadSelectedBootstrapModule(isPublic, { public: mockPublic, operator: mockOperator }, options),
    };
  });
  mockOperator.mockReset();
  mockPublic.mockReset();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  jest.useRealTimers();
});

it.each([
  "/#/stream", "/#/stream-info", "/?cacheBust=1#/stream-info?controllerId=abc",
  "/#/projector", "/#/projector-full?outputId=main", "/#/monitor", "/#/credits",
  "/#/boards/display", "/#/boards/present/abc?preview=1", "/boards/present/abc?preview=1",
  "/index.html#/stream?outputId=obs",
])("keeps fresh/refresh startup empty while the module is delayed: %s", async (url) => {
  const pending = deferred();
  mockOperator.mockReturnValue(pending.promise);
  mockPublic.mockReturnValue(pending.promise);
  await start(url);
  expectEmpty();
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expectEmpty();
  expect(url.startsWith("/boards/present") ? mockPublic : mockOperator).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(loaded); });
  expect(screen.getByText("Output content")).toBeInTheDocument();
});

it("stays empty through module failure, retry, and successful recovery", async () => {
  const retry = deferred();
  mockOperator.mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
    .mockReturnValueOnce(retry.promise);
  await start("/#/stream-info?outputId=obs");
  expectEmpty();
  expect(mockBreadcrumb).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(300); });
  expect(mockOperator).toHaveBeenCalledTimes(2);
  expectEmpty();
  await act(async () => { retry.resolve(loaded); });
  expect(screen.getByText("Output content")).toBeInTheDocument();
});

it("stays empty at terminal post-reload failure, reports diagnostics, and stops retrying", async () => {
  sessionStorage.setItem("worshipsync:bootstrap-chunk-reload", "1");
  mockOperator.mockRejectedValue(new TypeError("Failed to fetch dynamically imported module"));
  await start("/#/stream");
  await act(async () => { jest.advanceTimersByTime(300); });
  expectEmpty();
  expect(mockCapture).toHaveBeenCalledTimes(1);
  expect(mockScope.setTag).toHaveBeenCalledWith("recovery_outcome", "exhausted");
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(mockOperator).toHaveBeenCalledTimes(2);
});

it("reports non-module startup failures without painting recovery UI on a display", async () => {
  mockOperator.mockRejectedValue(new Error("Startup failed"));
  await start("/#/stream");
  expectEmpty();
  expect(mockCapture).toHaveBeenCalledTimes(1);
  expect(mockOperator).toHaveBeenCalledTimes(1);
});

it.each(["/#/home", "/#/controller", "/home", "/#/stream-editor", "/#/boards/present/abc/extra"]) (
  "preserves branded loading and recovery on normal/unrelated routes: %s", async (url) => {
    const pending = deferred();
    mockOperator.mockReturnValue(pending.promise);
    await start(url);
    expect(screen.getByRole("img", { name: "WorshipSync" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("bg-homepage-canvas");
    await act(async () => { pending.reject(new Error("Startup failed")); });
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("bg-homepage-canvas");
  },
);
