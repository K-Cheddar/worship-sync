import {
  importCanvaDesign,
  type CanvaImportProgressEvent,
} from "./canva";

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
