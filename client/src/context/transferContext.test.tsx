import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { TransferProvider, useTransfers } from "./transferContext";
import { MediaAddControl } from "../containers/Media/MediaAddControl";
import { CanvaMediaReconciliationRequiredError } from "../utils/canvaMediaReplacement";

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
    <MediaAddControl
      uploadProgress={{ isUploading: false, progress: 0 }}
      uploadTitle="Add Media"
      onUploadClick={() => undefined}
      disabled={false}
    >
      <button>Add media</button>
    </MediaAddControl>
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
  expect(screen.getByRole("link", { name: "View presentation" })).toHaveAttribute("href", "/controller/item-1");
  expect(screen.getByRole("link", { name: "View presentation" })).toHaveClass("cursor-pointer");
});

test("minimizing and restoring keeps the active Canva import progress", async () => {
  const gate = deferred<typeof result>();
  const user = userEvent.setup();
  const SlowHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <>
    <MediaAddControl
      uploadProgress={{ isUploading: false, progress: 0 }}
      uploadTitle="Add Media"
      onUploadClick={() => undefined}
      disabled={false}
    ><button>Add media</button></MediaAddControl>
    <button onClick={() => startCanvaTransfer({
      id: "slow-canva", title: "Slow deck", format: "mp4", pages: [1, 2],
      run: (_signal, progress) => {
        progress({ type: "started", total: 2, pages: [1, 2] });
        progress({ type: "page-progress", page: 1, status: "processing" });
        return gate.promise;
      },
      finalize: async () => ({ importedCount: 2 }),
    })}>Start slow import</button>
    </>;
  };
  render(<MemoryRouter><TransferProvider><SlowHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start slow import" }));
  expect(await screen.findByText("0 of 2 pages processed · 0%")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Minimize transfers" }));
  expect(screen.queryByRole("complementary", { name: "Transfers" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Show transfer progress: 0 of 2 pages processed · 0%/ })).toHaveTextContent("0%");
  await user.click(screen.getByRole("button", { name: /Show transfer progress:/ }));
  expect(screen.getByRole("complementary", { name: "Transfers" })).toBeInTheDocument();
  expect(screen.getByText("0 of 2 pages processed · 0%")).toBeInTheDocument();
  await act(async () => gate.resolve(result));
  expect(await screen.findByText("2 slides imported")).toBeInTheDocument();
});

test("only offers View presentation when finalization returns a destination", async () => {
  const user = userEvent.setup();
  const NoPresentationHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "no-presentation",
      title: "Media-only import",
      format: "png",
      pages: [1],
      run: async () => result,
      finalize: async () => ({ importedCount: 1 }),
    })}>Import media only</button>;
  };
  render(<MemoryRouter><TransferProvider><NoPresentationHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Import media only" }));
  expect(await screen.findByText("1 slides imported")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "View presentation" })).not.toBeInTheDocument();
});

test("shows indeterminate preparation before switching to page progress and completion", async () => {
  const processing = deferred<void>();
  const persisted = deferred<void>();
  const user = userEvent.setup();
  const ProgressHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "progress-canva",
      title: "Ten page deck",
      format: "png",
      pages: Array.from({ length: 10 }, (_, index) => index + 1),
      run: async (_signal, progress) => {
        progress({ type: "started", total: 10, pages: Array.from({ length: 10 }, (_, index) => index + 1) });
        progress({ type: "page-progress", page: 1, status: "exporting" });
        await processing.promise;
        progress({ type: "page-progress", page: 1, status: "processing" });
        return result;
      },
      finalize: async (_result, _signal, onPagesPersisted) => {
        await persisted.promise;
        onPagesPersisted([1, 2, 3]);
        return { importedCount: 3 };
      },
    })}>Start phased import</button>;
  };
  render(<MemoryRouter><TransferProvider><ProgressHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start phased import" }));
  expect(await screen.findByText("Requesting Canva export · page 1 of 10")).toBeInTheDocument();
  const progressbar = screen.getByRole("progressbar", { name: "Ten page deck progress" });
  expect(progressbar).not.toHaveAttribute("aria-valuenow");
  expect(screen.queryByText(/pages processed ·/)).not.toBeInTheDocument();

  await act(async () => processing.resolve());
  await screen.findByText(/0 of 10 pages processed · 0%/);
  expect(progressbar).toHaveAttribute("aria-valuenow", "0");

  await act(async () => persisted.resolve());
  await screen.findByText(/3 of 10 pages processed · 30%/);
  expect(await screen.findByText("3 slides imported")).toBeInTheDocument();
  expect(screen.getByText(/3 of 10 pages processed · 30%/)).toBeInTheDocument();
});

test("warns before a browser refresh while a Canva request is active", async () => {
  const gate = deferred<typeof result>();
  const user = userEvent.setup();
  const SlowHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "refresh-canva", title: "Refresh-sensitive deck", format: "png", pages: [1],
      run: () => gate.promise,
      finalize: async () => ({ importedCount: 1 }),
    })}>Start refresh-sensitive import</button>;
  };
  render(<MemoryRouter><TransferProvider><SlowHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start refresh-sensitive import" }));
  const event = new Event("beforeunload", { cancelable: true });
  fireEvent(window, event);
  expect(event.defaultPrevented).toBe(true);
});

test("cancellation is explicit and waits for the job to stop", async () => {
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
  expect(screen.getByRole("dialog", { name: "Cancel this import?" })).toBeInTheDocument();
  expect(signal?.aborted).toBe(false);
  await user.click(screen.getByRole("button", { name: "Cancel import" }));
  expect(signal?.aborted).toBe(true);
  expect(await screen.findByText("Import cancelled")).toBeInTheDocument();
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

test("shows and retries cleanup that remained pending after a failed import", async () => {
  const user = userEvent.setup();
  const cleanupRetry = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
  const PendingCleanupHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "pending-cleanup",
      title: "Pending cleanup deck",
      format: "png",
      pages: [1],
      run: async () => result,
      finalize: async () => { throw new Error("Import failed. 1 Canva asset could not be removed."); },
      cleanupRetry,
    })}>Start import</button>;
  };
  render(<MemoryRouter><TransferProvider><PendingCleanupHarness /></TransferProvider></MemoryRouter>);

  await user.click(screen.getByRole("button", { name: "Start import" }));
  expect(await screen.findByRole("button", { name: "Retry cleanup" })).toBeInTheDocument();
  expect(screen.getByText(/Some unused Canva files still need cleanup/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry cleanup" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry cleanup" })).not.toBeInTheDocument());
  expect(cleanupRetry).toHaveBeenCalledTimes(1);
});

test("reports an unresolved Canva replacement as a failed page with recovery guidance", async () => {
  const user = userEvent.setup();
  const ReconciliationHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "reconciliation-required",
      title: "Welcome slide",
      format: "png",
      pages: [1],
      run: async () => result,
      finalize: async () => {
        throw new CanvaMediaReconciliationRequiredError(
          "Canva refresh needs attention. Saved media references could not be confirmed, so both files were kept. Reload Media before trying again.",
        );
      },
    })}>Refresh Canva slide</button>;
  };
  render(<MemoryRouter><TransferProvider><ReconciliationHarness /></TransferProvider></MemoryRouter>);

  await user.click(screen.getByRole("button", { name: "Refresh Canva slide" }));

  expect(await screen.findByText("Import failed")).toBeInTheDocument();
  expect(screen.getAllByText(/Saved media references could not be confirmed/)).toHaveLength(2);
  expect(screen.getByText(/0 of 1 pages processed/)).toBeInTheDocument();
});

test("cancelling a queued Canva job prevents its export from starting", async () => {
  const gate = deferred<typeof result>();
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
  await user.click(screen.getByRole("button", { name: "Cancel import" }));
  await act(async () => gate.resolve(result));
  expect(await screen.findByText("Import cancelled before any pages were saved.")).toBeInTheDocument();
  expect(secondRun).not.toHaveBeenCalled();
});

test("cancelling between page saves keeps the first committed page", async () => {
  const gate = deferred<void>();
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
  await screen.findByText("1 of 2 pages processed · 50%");
  await user.click(screen.getByRole("button", { name: "Cancel Finalizing deck" }));
  await user.click(screen.getByRole("button", { name: "Cancel import" }));
  await act(async () => gate.resolve());
  expect(await screen.findByText(/Import cancelled after saving 1 page/)).toBeInTheDocument();
  expect(screen.getByText("1 of 2 pages processed · 50%")).toBeInTheDocument();
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
  expect(screen.getByText("1 of 2 pages processed · 50%")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "View presentation" })).not.toBeInTheDocument();
});

