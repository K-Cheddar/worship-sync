import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import { getTransferOverview, TransferProvider, useTransfers } from "./transferContext";
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
  const { startCanvaTransfer, updateTransfer } = useTransfers();
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <MediaAddControl>
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
    <button onClick={() => updateTransfer({ id: "media-upload", type: "Media upload", name: "Video.mp4", status: "active", progress: 42, phase: { key: "uploading", label: "Uploading" } })}>Start upload</button>
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
  expect(screen.getByRole("complementary", { name: "Activity" })).toBeInTheDocument();
  expect(within(screen.getByRole("complementary", { name: "Activity" })).getByTestId("activity-icon")).toHaveClass("text-cyan-300");
  await user.click(screen.getByRole("button", { name: "Navigate elsewhere" }));
  expect(screen.getByText("Route /elsewhere")).toBeInTheDocument();
  expect(await screen.findByText(/3 slides imported/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View presentation" })).toHaveAttribute("href", "/controller/item-1");
  expect(screen.getByRole("link", { name: "View presentation" })).toHaveClass("cursor-pointer");
});

test("invokes producer-neutral actions and unregisters handlers cleanly", async () => {
  const user = userEvent.setup();
  const action = jest.fn();
  const GenericActionHarness = () => {
    const { updateTransfer, registerTransferAction } = useTransfers();
    const unregisterRef = useRef<(() => void) | null>(null);
    return <>
      <button onClick={() => {
        unregisterRef.current = registerTransferAction("generic-transfer", "custom", action);
        updateTransfer({ id: "generic-transfer", type: "Example", name: "Generic work", status: "active", progress: 10, actions: [{ key: "custom", label: "Run custom action" }, { key: "dismiss", label: "Dismiss" }] });
      }}>Start generic work</button>
      <button onClick={() => unregisterRef.current?.()}>Unregister action</button>
    </>;
  };
  render(<MemoryRouter><TransferProvider><GenericActionHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start generic work" }));
  await user.click(screen.getByRole("button", { name: "Run custom action" }));
  expect(action).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Unregister action" }));
  await user.click(screen.getByRole("button", { name: "Run custom action" }));
  expect(action).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("Generic work")).not.toBeInTheDocument();
});

test("dismisses completed Canva transfers through their registered action", async () => {
  const user = userEvent.setup();
  const DismissHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <button onClick={() => startCanvaTransfer({
      id: "dismiss-canva", title: "Dismissible deck", format: "png", pages: [1],
      run: async () => result,
      finalize: async () => ({ importedCount: 1 }),
    })}>Import dismissible deck</button>;
  };
  render(<MemoryRouter><TransferProvider><DismissHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Import dismissible deck" }));
  expect(await screen.findByText("Dismissible deck")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("Dismissible deck")).not.toBeInTheDocument();
});

test("minimizing and restoring keeps the active Canva import progress", async () => {
  const gate = deferred<typeof result>();
  const user = userEvent.setup();
  const SlowHarness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <>
    <MediaAddControl><button>Add media</button></MediaAddControl>
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
  expect(await screen.findByText(/Processing Canva pages · 0 of 2/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Minimize activity" }));
  expect(screen.queryByRole("complementary", { name: "Activity" })).not.toBeInTheDocument();
  expect(screen.getByTestId("activity-panel")).toHaveClass("transition-[opacity,transform]", "scale-95", "opacity-0");
  expect(screen.getByTestId("activity-panel")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getAllByRole("button", { name: "Show Activity · 1 active" })).toHaveLength(1);
  const localActivity = screen.getByRole("button", { name: "Show Activity · 1 active" });
  expect(localActivity).toHaveTextContent("Activity · 1 active");
  expect(within(localActivity).getByTestId("activity-icon")).toHaveClass("text-cyan-300");
  await user.click(localActivity);
  expect(screen.getByRole("heading", { name: "Activity · 1 active" })).toBeInTheDocument();
  expect(screen.getByTestId("activity-panel")).toHaveClass("scale-100", "opacity-100");
  expect(screen.getByTestId("activity-panel")).not.toHaveAttribute("aria-hidden");
  expect(screen.getByText(/Processing Canva pages · 0 of 2/)).toBeInTheDocument();
  expect(screen.getByText(/Processing Canva pages · 0 of 2/)).toBeInTheDocument();
  await act(async () => gate.resolve(result));
  expect(await screen.findByText(/2 slides imported/)).toBeInTheDocument();
});

test("uses attention counts and amber Activity state for failed work", async () => {
  const user = userEvent.setup();
  const FailedHarness = () => {
    const { updateTransfer } = useTransfers();
    return <button onClick={() => updateTransfer({
      id: "failed-upload", type: "Media upload", name: "Cloud upload · 1 item", status: "failed", progress: 0,
      phase: { key: "failed", label: "Upload failed" }, error: { message: "1 item failed to upload." },
      actions: [{ key: "dismiss", label: "Dismiss" }],
    })}>Finish failed upload</button>;
  };
  render(<MemoryRouter><TransferProvider><FailedHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Finish failed upload" }));
  expect(await screen.findByRole("heading", { name: "Activity · 1 needs attention" })).toBeInTheDocument();
  expect(screen.queryByText("Activity · 0 active")).not.toBeInTheDocument();
  expect(screen.getByTestId("activity-icon")).toHaveClass("text-amber-300");
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
});

test("combines active and attention counts in the Activity header", async () => {
  const user = userEvent.setup();
  const MixedHarness = () => {
    const { updateTransfer } = useTransfers();
    return <>
      <button onClick={() => updateTransfer({ id: "running", type: "Media upload", name: "Running.mp4", status: "active", progress: 25 })}>Start upload</button>
      <button onClick={() => updateTransfer({ id: "failed", type: "Media deletion", name: "Delete photo.jpg", status: "partial", progress: null })}>Finish partial deletion</button>
    </>;
  };
  render(<MemoryRouter><TransferProvider><MixedHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start upload" }));
  await user.click(screen.getByRole("button", { name: "Finish partial deletion" }));
  expect(await screen.findByRole("heading", { name: "Activity · 1 active · 1 needs attention" })).toBeInTheDocument();
  expect(screen.getByTestId("activity-icon")).toHaveClass("text-amber-300");
});

test("shows the minimized global fallback only when no local Activity host is mounted", async () => {
  const user = userEvent.setup();
  const HostHarness = () => {
    const { updateTransfer } = useTransfers();
    const [showLocalHost, setShowLocalHost] = useState(false);
    return <>
      <button onClick={() => updateTransfer({ id: "active", type: "Media upload", name: "Upload.mp4", status: "active", progress: 30 })}>Start upload</button>
      <button onClick={() => setShowLocalHost((shown) => !shown)}>Toggle local Activity host</button>
      {showLocalHost ? <MediaAddControl><button>Add media</button></MediaAddControl> : null}
    </>;
  };
  render(<MemoryRouter><TransferProvider><HostHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start upload" }));
  await user.click(screen.getByRole("button", { name: "Minimize activity" }));
  expect(screen.getByTestId("global-activity-fallback")).toBeInTheDocument();
  expect(screen.getByTestId("activity-panel")).toHaveClass("scale-95", "opacity-0");
  expect(screen.getByTestId("activity-panel")).toHaveAttribute("aria-hidden", "true");

  await user.click(screen.getByTestId("global-activity-fallback"));
  await user.click(screen.getByRole("button", { name: "Minimize activity" }));
  await user.click(screen.getByRole("button", { name: "Toggle local Activity host" }));
  expect(screen.queryByTestId("global-activity-fallback")).not.toBeInTheDocument();
  const localActivity = screen.getByRole("button", { name: "Show Activity · 1 active" });
  await user.click(localActivity);
  expect(screen.getByRole("complementary", { name: "Activity" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Minimize activity" }));
  expect(screen.queryByTestId("global-activity-fallback")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Toggle local Activity host" }));
  expect(screen.getByTestId("global-activity-fallback")).toBeInTheDocument();
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
  expect(await screen.findByText(/1 slides imported/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "View presentation" })).not.toBeInTheDocument();
});

test("shows export and processing phases in overall Canva progress", async () => {
  const remainingRequests = deferred<void>();
  const processing = deferred<void>();
  const persisted = deferred<void>();
  const finalizing = deferred<void>();
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
        [1, 2, 3].forEach((page) => progress({ type: "page-progress", page, status: "exporting" }));
        await remainingRequests.promise;
        [4, 5, 6, 7, 8, 9, 10].forEach((page) => progress({ type: "page-progress", page, status: "exporting" }));
        await processing.promise;
        progress({ type: "page-progress", page: 1, status: "processing" });
        return result;
      },
      finalize: async (_result, _signal, onPagesPersisted) => {
        await persisted.promise;
        onPagesPersisted([1, 2, 3, 4, 5]);
        await finalizing.promise;
        return { importedCount: 5 };
      },
    })}>Start phased import</button>;
  };
  render(<MemoryRouter><TransferProvider><ProgressHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start phased import" }));
  expect(await screen.findByText(/Requesting Canva export · 3 of 10/)).toBeInTheDocument();
  const progressbar = screen.getByRole("progressbar", { name: "Ten page deck progress" });
  expect(progressbar).toHaveAttribute("aria-valuenow", "15");
  expect(screen.queryByText(/pages processed ·/)).not.toBeInTheDocument();

  await act(async () => remainingRequests.resolve());
  expect(await screen.findByText(/Requesting Canva export · 10 of 10/)).toBeInTheDocument();
  expect(progressbar).toHaveAttribute("aria-valuenow", "50");

  await act(async () => processing.resolve());
  await screen.findByText(/Saving presentation slides · 0 of 10/);
  expect(progressbar).toHaveAttribute("aria-valuenow", "50");

  await act(async () => persisted.resolve());
  await screen.findByText(/Saving presentation slides · 5 of 10/);
  await act(async () => finalizing.resolve());
  expect(await screen.findByText(/5 slides imported/)).toBeInTheDocument();
  expect(screen.getByText(/5 of 10 pages processed/)).toBeInTheDocument();
  expect(progressbar).toHaveAttribute("aria-valuenow", "100");
});

test("keeps Add available and summarizes the shared aggregate across active transfers", async () => {
  const gate = deferred<typeof result>();
  const finalizing = deferred<void>();
  const user = userEvent.setup();
  const addAction = jest.fn();
  const AggregateHarness = () => {
    const { startCanvaTransfer, updateTransfer } = useTransfers();
    return <>
      <MediaAddControl><button onClick={addAction}>Add media</button></MediaAddControl>
      <button onClick={() => startCanvaTransfer({
        id: "aggregate-canva",
        title: "Aggregate deck",
        format: "png",
        pages: [1, 2],
        run: (_signal, progress) => {
          progress({ type: "started", total: 2, pages: [1, 2] });
          progress({ type: "page-progress", page: 1, status: "exporting" });
          return gate.promise;
        },
        finalize: async (_importResult, _signal, onPagesPersisted) => {
          onPagesPersisted([1, 2]);
          await finalizing.promise;
          return { importedCount: 2 };
        },
      })}>Start aggregate import</button>
      <button onClick={() => updateTransfer({
        id: "aggregate-upload",
        type: "Media upload",
        name: "Video.mp4",
        status: "active",
        progress: 75,
        phase: { key: "uploading", label: "Uploading" },
      })}>Start aggregate upload</button>
      <button onClick={() => updateTransfer({
        id: "aggregate-upload",
        type: "Media upload",
        name: "Video.mp4",
        status: "complete",
        progress: 100,
        phase: { key: "complete", label: "Upload complete" },
      })}>Finish aggregate upload</button>
    </>;
  };

  render(<MemoryRouter><TransferProvider><AggregateHarness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start aggregate import" }));
  await user.click(screen.getByRole("button", { name: "Start aggregate upload" }));
  expect(await screen.findByRole("button", { name: "Add media" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add media" }));
  expect(addAction).toHaveBeenCalledTimes(1);
  const activityControl = screen.getByRole("button", { name: "Show Activity · 2 active" });
  expect(activityControl).toHaveTextContent("Activity · 2 active");
  expect(activityControl).not.toHaveTextContent("%");
  await user.click(activityControl);
  expect(screen.getByRole("heading", { name: "Activity · 2 active" })).toBeInTheDocument();
  expect(screen.getAllByText(/Canva · Requesting Canva export · 1 of 2/)).toHaveLength(1);
  expect(screen.getAllByText(/Media upload · Uploading/)).toHaveLength(1);
  expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  expect(screen.getByRole("complementary", { name: "Activity" })).toBeInTheDocument();
  await act(async () => gate.resolve(result));
  await user.click(screen.getByRole("button", { name: "Finish aggregate upload" }));
  expect(await screen.findByRole("button", { name: "Add media" })).toBeInTheDocument();
  await act(async () => finalizing.resolve());
});

test("uses the arithmetic mean of normalized active transfer progress", () => {
  const upload = (id: string, progress: number) => ({
    id, type: "upload", name: id, status: "active" as const, progress, phase: { key: "uploading", label: "Uploading" },
  });
  expect(getTransferOverview([upload("one", 60)]).progress).toBe(60);
  expect(getTransferOverview([upload("first", 80), upload("second", 20)]).progress).toBe(50);
  expect(getTransferOverview([upload("first", 80), upload("new", 0)]).progress).toBe(40);
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
  expect(await screen.findByText(/Import cancelled before/)).toBeInTheDocument();
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
  expect(await screen.findByText(/2 slides imported/)).toBeInTheDocument();
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
  expect(await screen.findByText("Complete")).toBeInTheDocument();
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

  expect(await screen.findByText("Failed")).toBeInTheDocument();
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

test("cancelling a queued job releases dedupe immediately without clearing its replacement later", async () => {
  const firstGate = deferred<typeof result>();
  const retryGate = deferred<typeof result>();
  const user = userEvent.setup();
  const cancelledRun = jest.fn(async () => result);
  const retryRun = jest.fn(() => retryGate.promise);
  const returnedIds: string[] = [];
  let requests = 0;
  const Harness = () => {
    const { startCanvaTransfer } = useTransfers();
    return <>
      <button onClick={() => startCanvaTransfer({ id: "first", title: "First deck", format: "png", pages: [1], run: () => firstGate.promise, finalize: async () => ({ importedCount: 1 }) })}>Start first</button>
      <button onClick={() => {
        requests += 1;
        returnedIds.push(startCanvaTransfer({
          id: `retry-${requests}`, title: "Retry deck", dedupeKey: "church:design:png:1", format: "png", pages: [1],
          run: requests === 1 ? cancelledRun : retryRun, finalize: async () => ({ importedCount: 1 }),
        }));
      }}>Request import</button>
    </>;
  };
  render(<MemoryRouter><TransferProvider><Harness /></TransferProvider></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Start first" }));
  await user.click(screen.getByRole("button", { name: "Request import" }));
  await user.click(screen.getByRole("button", { name: "Cancel Retry deck" }));
  await user.click(screen.getByRole("button", { name: "Cancel import" }));
  await user.click(screen.getByRole("button", { name: "Request import" }));
  await user.click(screen.getByRole("button", { name: "Request import" }));
  expect(returnedIds).toEqual(["retry-1", "retry-2", "retry-2"]);
  expect(retryRun).not.toHaveBeenCalled();
  await act(async () => firstGate.resolve(result));
  await waitFor(() => expect(retryRun).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "Request import" }));
  expect(returnedIds).toEqual(["retry-1", "retry-2", "retry-2", "retry-2"]);
  expect(cancelledRun).not.toHaveBeenCalled();
  await act(async () => retryGate.resolve(result));
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
  await screen.findByText(/Saving presentation slides · 1 of 2/);
  await user.click(screen.getByRole("button", { name: "Cancel Finalizing deck" }));
  await user.click(screen.getByRole("button", { name: "Cancel import" }));
  await act(async () => gate.resolve());
  expect(await screen.findByText(/Import cancelled after saving 1 page/)).toBeInTheDocument();
  expect(screen.getByText(/1 of 2 pages processed/)).toBeInTheDocument();
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
  expect(await screen.findByText(/Import completed with some pages failed/)).toBeInTheDocument();
  expect(screen.getByText(/Page 2: Could not export this page/)).toBeInTheDocument();
  expect(screen.getByText(/1 of 2 pages processed · 1 slides imported/)).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Partial deck progress" })).toHaveAttribute("aria-valuenow", "50");
  expect(screen.queryByRole("link", { name: "View presentation" })).not.toBeInTheDocument();
});

