import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { TransferProvider, useTransfers } from "./transferContext";

jest.mock("../hooks", () => ({ useDispatch: () => jest.fn() }));

const result = { assets: [], skippedCount: 0, revision: 10 };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const Harness = () => {
  const { startCanvaTransfer, updateUploadTransfer } = useTransfers();
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <p>Route {location.pathname}</p>
    <button onClick={() => startCanvaTransfer({
      id: "canva-1",
      title: "Sabbath Announcements",
      format: "png",
      pages: [1, 2, 3],
      run: async (_signal, progress) => {
        progress({ type: "started", total: 3, pages: [1, 2, 3] });
        progress({ type: "page-progress", page: 2, status: "exporting" });
        return result;
      },
      finalize: async (_importResult, _signal, onPagesPersisted) => {
        onPagesPersisted([1, 2, 3]);
        return { importedCount: 3, viewPath: "/controller/item-1" };
      },
    })}>Start Canva</button>
    <button onClick={() => updateUploadTransfer({ id: "media-upload", kind: "upload", title: "Video.mp4", status: "uploading", progress: 42, message: "Uploading video…" })}>Start upload</button>
    <button onClick={() => navigate("/elsewhere")}>Navigate elsewhere</button>
  </>;
};

const renderTransfers = () => render(<MemoryRouter><TransferProvider><Harness /></TransferProvider></MemoryRouter>);

test("keeps Canva jobs alive across route changes and shares the panel with media uploads", async () => {
  const user = userEvent.setup();
  renderTransfers();
  await user.click(screen.getByRole("button", { name: "Start Canva" }));
  await user.click(screen.getByRole("button", { name: "Start upload" }));
  expect(await screen.findByText("Sabbath Announcements")).toBeInTheDocument();
  expect(screen.getByText("Video.mp4")).toBeInTheDocument();
  expect(screen.getByText("42%", { exact: true })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Navigate elsewhere" }));
  expect(screen.getByText("Route /elsewhere")).toBeInTheDocument();
  expect(await screen.findByText("3 slides imported")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View presentation" })).toBeInTheDocument();
});

test("minimizing and expanding the panel does not interrupt an active Canva import", async () => {
  const gate = deferred<typeof result>();
  const user = userEvent.setup();
  const SlowHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "slow-canva", title: "Slow deck", format: "mp4", pages: [1, 2],
      run: () => gate.promise,
      finalize: async () => ({ importedCount: 2 }),
    })}>Start slow import</button>;
  };
  render(<MemoryRouter><TransferProvider><SlowHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start slow import" }));
  await user.click(screen.getByRole("button", { name: "Minimize transfers" }));
  expect(screen.getByText("1 active transfer · Expand")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Expand transfers" }));
  await act(async () => gate.resolve(result));
  expect(await screen.findByText("2 slides imported")).toBeInTheDocument();
});

test("cancellation is explicit and waits for the job to stop", async () => {
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  let signal: AbortSignal | undefined;
  const SlowHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "cancel-canva", title: "Cancelable deck", format: "png", pages: [1],
      run: (jobSignal) => {
        signal = jobSignal;
        return new Promise<typeof result>((_resolve, reject) => jobSignal.addEventListener("abort", () => reject(new Error("Canva import cancelled.")), { once: true }));
      },
      finalize: async () => ({ importedCount: 1 }),
    })}>Start cancellable import</button>;
  };
  render(<MemoryRouter><TransferProvider><SlowHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start cancellable import" }));
  await waitFor(() => expect(signal).toBeDefined());
  await user.click(screen.getByRole("button", { name: "Cancel Cancelable deck" }));
  expect(confirm).toHaveBeenCalled();
  expect(signal?.aborted).toBe(true);
  expect(await screen.findByText("Import cancelled")).toBeInTheDocument();
  confirm.mockRestore();
});

test("deduplicates an identical Canva job while it is active or queued", async () => {
  const gate = deferred<typeof result>();
  const user = userEvent.setup();
  let runCount = 0;
  const DuplicateHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <>
      <button onClick={() => startCanvaTransfer({
        id: `duplicate-${runCount}`,
        dedupeKey: "church-1:design-1:png:1,2",
        title: "Duplicate deck",
        format: "png",
        pages: [1, 2],
        run: () => { runCount += 1; return gate.promise; },
        finalize: async () => ({ importedCount: 2 }),
      })}>Request duplicate</button>
    </>;
  };
  render(<MemoryRouter><TransferProvider><DuplicateHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Request duplicate" }));
  await user.click(screen.getByRole("button", { name: "Request duplicate" }));
  await waitFor(() => expect(runCount).toBe(1));
  await act(async () => gate.resolve(result));
  expect(await screen.findByText("2 slides imported")).toBeInTheDocument();
  expect(runCount).toBe(1);
});

test("offers a custom-item retry after media import without rerunning Canva", async () => {
  const user = userEvent.setup();
  const retry = jest.fn().mockResolvedValue("/controller/item-canva");
  const PartialCustomHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "partial-custom",
      title: "Custom deck",
      format: "png",
      pages: [1],
      run: async () => result,
      finalize: async (_importResult, _signal, onPagesPersisted) => {
        onPagesPersisted([1]);
        return { importedCount: 1, customItemError: "Database unavailable." };
      },
      customItemRetry: retry,
    })}>Import custom deck</button>;
  };
  render(<MemoryRouter><TransferProvider><PartialCustomHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Import custom deck" }));
  expect(await screen.findByText(/Media was imported, but the custom item was not created/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry custom item" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Import complete")).toBeInTheDocument();
});

test("cancelling a queued Canva job prevents its export from starting", async () => {
  const gate = deferred<typeof result>();
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  const secondRun = jest.fn(async () => result);
  const QueuedHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <>
      <button onClick={() => startCanvaTransfer({ id: "first-queued", title: "First deck", format: "png", pages: [1], run: () => gate.promise, finalize: async () => ({ importedCount: 1 }) })}>Start first</button>
      <button onClick={() => startCanvaTransfer({ id: "second-queued", title: "Second deck", format: "png", pages: [1], run: secondRun, finalize: async () => ({ importedCount: 1 }) })}>Start second</button>
    </>;
  };
  render(<MemoryRouter><TransferProvider><QueuedHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start first" }));
  await user.click(screen.getByRole("button", { name: "Start second" }));
  await user.click(screen.getByRole("button", { name: "Cancel Second deck" }));
  await act(async () => gate.resolve(result));
  expect(await screen.findByText("Import cancelled before any pages were saved.")).toBeInTheDocument();
  expect(secondRun).not.toHaveBeenCalled();
  confirm.mockRestore();
});

test("cancelling between page saves keeps the first committed page", async () => {
  const gate = deferred<void>();
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  const FinalizingHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "finalizing-canva", title: "Finalizing deck", format: "png", pages: [1, 2],
      run: async () => result,
      finalize: async (_importResult, signal, onPagesPersisted) => {
        onPagesPersisted([1]);
        await gate.promise;
        if (signal.aborted) throw new Error("Canva import cancelled.");
        onPagesPersisted([2]);
        return { importedCount: 2 };
      },
    })}>Start finalizing import</button>;
  };
  render(<MemoryRouter><TransferProvider><FinalizingHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start finalizing import" }));
  await screen.findByText("1 of 2 pages processed · 50% of pages");
  await user.click(screen.getByRole("button", { name: "Cancel Finalizing deck" }));
  await act(async () => gate.resolve());
  expect(await screen.findByText(/Import cancelled after saving 1 page/)).toBeInTheDocument();
  expect(screen.getByText("1 of 2 pages processed · 50% of pages")).toBeInTheDocument();
  confirm.mockRestore();
});

test("keeps successful pages and reports failed pages as a partial import", async () => {
  const user = userEvent.setup();
  const PartialHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "partial-canva", title: "Partial deck", format: "png", pages: [1, 2],
      run: async (_signal, progress) => {
        progress({ type: "started", total: 2, pages: [1, 2] });
        return { ...result, failedPages: [{ page: 2, error: "Could not export this page. Try again." }] };
      },
      finalize: async (_importResult, _signal, onPagesPersisted) => {
        onPagesPersisted([1]);
        return { importedCount: 1, failedPages: [{ page: 2, error: "Could not export this page. Try again." }] };
      },
    })}>Start partial import</button>;
  };
  render(<MemoryRouter><TransferProvider><PartialHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start partial import" }));
  expect(await screen.findByText("Import completed with some pages failed")).toBeInTheDocument();
  expect(screen.getByText(/Page 2: Could not export this page/)).toBeInTheDocument();
  expect(screen.getByText("1 of 2 pages processed · 50% of pages")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View presentation" })).toBeInTheDocument();
});

