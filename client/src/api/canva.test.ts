import {
  importCanvaDesign,
  type CanvaImportProgressEvent,
} from "./canva";
import { CanvaImportError } from "../utils/canvaImportError";

test("reads Canva import progress events from the NDJSON response", async () => {
  const result = {
    assets: [],
    skippedCount: 0,
    revision: 100,
  };
  const encoder = new TextEncoder();
  const reader = {
    read: jest
      .fn()
      .mockResolvedValueOnce({
        value: encoder.encode(
          '{"type":"started","total":2,"pages":[1,2]}\n{"type":"page-progress","page":1,"status":"exporting"}\n',
        ),
        done: false,
      })
      .mockResolvedValueOnce({
        value: encoder.encode(`{"type":"complete","result":${JSON.stringify(result)}}\n`),
        done: true,
      }),
  };
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "application/x-ndjson" }),
    body: { getReader: () => reader },
  } as unknown as Response);
  const progress: CanvaImportProgressEvent[] = [];

  await expect(
    importCanvaDesign(
      "church-1",
      {
        designId: "design-1",
        pages: [1, 2],
        format: "mp4",
        mp4ImportMode: "separate",
        existingImportKeys: [],
      },
      (event) => progress.push(event),
    ),
  ).resolves.toEqual(result);

  expect(progress.map((event) => event.type)).toEqual([
    "started",
    "page-progress",
    "complete",
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockRestore();
});

test("aborts an active Canva import when its caller cancels", async () => {
  const externalController = new AbortController();
  const reader = {
    read: jest.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          externalController.signal.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"));
          });
        }),
    ),
  };
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "application/x-ndjson" }),
    body: { getReader: () => reader },
  } as unknown as Response);

  const importPromise = importCanvaDesign(
    "church-1",
    {
      designId: "design-1",
      pages: [1],
      format: "mp4",
      existingImportKeys: [],
    },
    undefined,
    { signal: externalController.signal },
  );
  await Promise.resolve();
  externalController.abort();

  await expect(importPromise).rejects.toThrow("Canva import cancelled.");
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  fetchMock.mockRestore();
});

test("keeps the long timeout for a stalled Canva import", async () => {
  jest.useFakeTimers();
  const fetchMock = jest.spyOn(global, "fetch").mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  const importPromise = importCanvaDesign("church-1", {
    designId: "design-1",
    pages: [1],
    format: "mp4",
    existingImportKeys: [],
  });
  const rejection = importPromise.then(
    () => undefined,
    (error: unknown) => error,
  );
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(8 * 60 * 1000);

  await expect(await rejection).toHaveProperty(
    "message",
    "Canva took too long to complete the import. Try again.",
  );
  fetchMock.mockRestore();
  jest.useRealTimers();
});

test("preserves Canva import API errors and status details", async () => {
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: false,
    status: 429,
    headers: new Headers({ "content-type": "application/json" }),
    json: () =>
      Promise.resolve({ error: "Canva rate limited the export.", code: "CANVA_RATE_LIMITED" }),
  } as unknown as Response);

  const importPromise = importCanvaDesign("church-1", {
      designId: "design-1",
      pages: [1],
      format: "png",
      existingImportKeys: [],
    });

  await expect(importPromise).rejects.toBeInstanceOf(CanvaImportError);
  await expect(importPromise).rejects.toMatchObject<Partial<CanvaImportError>>({
    message: "Canva rate limited the export.",
    code: "CANVA_RATE_LIMITED",
    status: 429,
  });
  fetchMock.mockRestore();
});
