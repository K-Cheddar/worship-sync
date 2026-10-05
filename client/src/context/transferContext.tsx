import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import Button from "../components/Button/Button";
import Modal from "../components/Modal/Modal";
import { TransferProgress } from "../components/TransferProgress/TransferProgress";
import type { CanvaImportProgressEvent, CanvaImportResult } from "../api/canva";
import { formatCanvaImportError } from "../utils/canvaImportError";
import { getTransferOverview, type Transfer } from "./transferModel";

type CanvaStatus = "queued" | "exporting" | "processing" | "finalizing" | "completed" | "partial" | "failed" | "cancelled";
type CanvaPageState = {
  status: "waiting" | "exporting" | "processing" | "saving" | "ready" | "error" | "cancelled";
  requested?: boolean;
  processed?: boolean;
  skipped?: boolean;
};
type CanvaTransferRuntime = {
  id: string;
  title: string;
  format: "png" | "mp4";
  pages: number[];
  status: CanvaStatus;
  lastProgress?: number;
  pageStatus: Record<number, CanvaPageState>;
  error?: string;
  importedCount?: number;
  viewPath?: string;
  failedPages?: Array<{ page: number; error: string }>;
  customItemError?: string;
  customItemRetry?: () => Promise<string | void>;
  customItemRetryPending?: boolean;
  cleanupRetry?: () => Promise<void>;
  cleanupRetryPending?: boolean;
  cleanupError?: string;
  dedupeKey?: string;
  controller?: AbortController;
  run: (signal: AbortSignal, onProgress: (event: CanvaImportProgressEvent) => void) => Promise<CanvaImportResult>;
  finalize: (result: CanvaImportResult, signal: AbortSignal, onPagesPersisted: (pages: number[]) => void) => Promise<{ importedCount: number; viewPath?: string; failedPages?: CanvaImportResult["failedPages"]; customItemError?: string }>;
};

export type CanvaTransferInput = Omit<CanvaTransferRuntime, "status" | "lastProgress" | "pageStatus" | "controller" | "customItemRetryPending" | "cleanupRetryPending" | "cleanupError">;
export type ActiveTransferSummary = Pick<Transfer, "id" | "name" | "type" | "status" | "progress" | "phase" | "detail" | "error" | "result">;

type TransferContextValue = {
  transfers: Transfer[];
  isMinimized: boolean;
  minimizeTransfers: () => void;
  restoreTransfers: () => void;
  startCanvaTransfer: (input: CanvaTransferInput) => string;
  updateTransfer: (transfer: Transfer) => void;
  removeTransfer: (id: string) => void;
  registerTransferAction: (id: string, key: string, handler: () => void | Promise<void>) => () => void;
  runTransferAction: (id: string, key: string) => Promise<void>;
};

type TransferActionsValue = Omit<TransferContextValue, "transfers" | "isMinimized" | "minimizeTransfers" | "restoreTransfers"> & {
  getTransfer: (id: string) => Transfer | undefined;
};

const TransferContext = createContext<TransferContextValue | null>(null);
const TransferActionsContext = createContext<TransferActionsValue | null>(null);
export const useTransfers = () => {
  const context = useContext(TransferContext);
  if (!context) throw new Error("Transfer panel is unavailable.");
  return context;
};
export const useOptionalTransfers = () => useContext(TransferContext);
export const useTransferActions = () => {
  const context = useContext(TransferActionsContext);
  if (!context) throw new Error("Transfer actions are unavailable.");
  return context;
};
export const useOptionalTransferActions = () => useContext(TransferActionsContext);

const getCanvaProgress = (item: CanvaTransferRuntime) => {
  const pages = item.pages.filter((page) => !item.pageStatus[page]?.skipped);
  const requested = pages.filter((page) => item.pageStatus[page]?.requested).length;
  const processed = pages.filter((page) => item.pageStatus[page]?.processed).length;
  return { total: pages.length, requested, processed };
};

const toCanvaTransfer = (job: CanvaTransferRuntime): Transfer => {
  const { total, requested, processed } = getCanvaProgress(job);
  const processing = job.status === "processing" || Object.values(job.pageStatus).some((page) => ["processing", "saving"].includes(page.status) || (page.status === "ready" && !page.skipped));
  const terminal = ["completed", "partial", "failed", "cancelled"].includes(job.status);
  const status: Transfer["status"] = job.status === "queued" ? "queued"
    : job.status === "completed" ? "complete"
      : job.status === "partial" ? "partial"
      : job.status === "failed" ? "failed"
        : job.status === "cancelled" ? "cancelled" : "active";
  const calculatedProgress = status === "complete" ? 100 : total ? ((requested + processed) / (total * 2)) * 100 : 0;
  job.lastProgress = status === "complete" ? 100 : Math.max(job.lastProgress ?? 0, calculatedProgress);
  const progress = job.lastProgress;
  const currentWaiting = job.pages.find((page) => job.pageStatus[page]?.status === "waiting");
  const phase = status === "complete" || status === "partial"
    ? { key: status, label: status === "partial" ? "Import completed with some pages failed" : "Import complete" }
    : status === "failed"
      ? { key: "failed", label: "Import failed" }
      : status === "cancelled"
        ? { key: "cancelled", label: "Import cancelled" }
        : status === "queued"
          ? { key: "queued", label: "Queued for Canva" }
          : job.status === "finalizing"
            ? { key: "finalizing", label: "Saving presentation slides", current: processed, total }
            : processing
              ? { key: "processing", label: "Processing Canva pages", current: processed, total }
              : currentWaiting && requested === 0
                ? { key: "waiting", label: `Waiting for Canva to prepare export · page ${currentWaiting} of ${job.pages.length}` }
                : { key: "requesting", label: "Requesting Canva export", current: requested, total };
  const failedPageDetails = job.failedPages?.length
    ? job.failedPages.map(({ page, error }) => `Page ${page}: ${error}`).join(" ")
    : undefined;
  const errorMessage = job.cleanupError
    ? `Some unused Canva files still need cleanup. ${job.cleanupError}`
    : job.customItemError
      ? `Media was imported, but the custom item was not created. ${job.customItemError}`
      : job.error;
  const actions: NonNullable<Transfer["actions"]> = [];
  if (!terminal) actions.push({
    key: "cancel",
    label: `Cancel ${job.title}`,
    confirmation: {
      title: "Cancel this import?",
      description: `Cancel importing “${job.title}”? Pages already saved in Media will remain available.`,
      confirmLabel: "Cancel import",
    },
  });
  else actions.push({ key: "dismiss", label: "Dismiss" });
  if (job.cleanupError && job.cleanupRetry) actions.push({ key: "retry-cleanup", label: job.cleanupRetryPending ? "Cleaning up…" : "Retry cleanup", pending: job.cleanupRetryPending });
  if (job.customItemError && job.customItemRetry) actions.push({ key: "retry-custom-item", label: job.customItemRetryPending ? "Creating…" : "Retry custom item", pending: job.customItemRetryPending });
  const detail = job.importedCount !== undefined
    ? `${job.status === "partial" ? "Import completed with some pages failed · " : ""}${processed} of ${total} pages processed · ${job.importedCount} slides imported${failedPageDetails ? ` · ${failedPageDetails}` : ""}`
    : terminal ? `${processed} of ${total} pages processed${failedPageDetails ? ` · ${failedPageDetails}` : ""}` : failedPageDetails;
  return {
    id: job.id,
    type: "Canva",
    name: job.title,
    status,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
    phase,
    ...(detail ? { detail } : {}),
    ...(errorMessage ? { error: { message: errorMessage } } : {}),
    ...(job.viewPath ? { result: { label: "View presentation", to: job.viewPath } } : {}),
    canCancel: !terminal,
    blocksUnload: status === "queued" || status === "active",
    actions,
  };
};

const TransferPanel = ({ transfers, isMinimized, onMinimize, runTransferAction }: {
  transfers: Transfer[];
  isMinimized: boolean;
  onMinimize: () => void;
  runTransferAction: TransferContextValue["runTransferAction"];
}) => {
  const [confirmation, setConfirmation] = useState<{ transfer: Transfer; action: NonNullable<Transfer["actions"]>[number] } | null>(null);
  const activeCount = getTransferOverview(transfers).activeCount;
  if (!transfers.length || isMinimized) return null;
  return (
    <>
      <aside aria-label="Transfers" className="fixed bottom-4 right-4 z-[80] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-600 bg-gray-900 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
          <div className="flex items-center gap-2"><span className="text-sm font-semibold">Transfers</span><span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs" aria-label={`${activeCount} active transfers`}>{activeCount} active</span></div>
          <Button variant="tertiary" svg={ChevronDown} aria-label="Minimize transfers" onClick={onMinimize} />
        </div>
        <ul className="max-h-[min(60vh,28rem)] space-y-2 overflow-y-auto p-2">
          {transfers.map((transfer) => <li key={transfer.id} className="rounded-md bg-gray-800 p-3">
            <TransferProgress transfer={transfer} variant="card" />
            {transfer.actions?.length ? <div className="mt-2 flex flex-wrap gap-2">
              {transfer.actions.map((action) => <Button key={action.key} variant="tertiary" disabled={action.pending} onClick={() => {
                if (action.confirmation) setConfirmation({ transfer, action });
                else void runTransferAction(transfer.id, action.key);
              }}>{action.label}</Button>)}
            </div> : null}
          </li>)}
        </ul>
      </aside>
      <Modal isOpen={Boolean(confirmation)} onClose={() => setConfirmation(null)} title={confirmation?.action.confirmation?.title || "Confirm transfer action"} description={confirmation?.action.confirmation?.description} size="sm">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmation(null)}>Keep importing</Button>
          <Button onClick={() => {
            if (confirmation) void runTransferAction(confirmation.transfer.id, confirmation.action.key);
            setConfirmation(null);
          }}>{confirmation?.action.confirmation?.confirmLabel || "Continue"}</Button>
        </div>
      </Modal>
    </>
  );
};

export const TransferProvider = ({ children }: { children: ReactNode }) => {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const transfersRef = useRef(transfers);
  transfersRef.current = transfers;
  const [isMinimized, setIsMinimized] = useState(false);
  const canvaQueue = useRef(Promise.resolve());
  const jobs = useRef(new Map<string, CanvaTransferRuntime>());
  const dedupeJobs = useRef(new Map<string, string>());
  const actionHandlers = useRef(new Map<string, Map<string, () => void | Promise<void>>>());
  const unregisterTransferActions = useCallback((id: string) => {
    actionHandlers.current.delete(id);
  }, []);
  const registerTransferAction = useCallback<TransferContextValue["registerTransferAction"]>((id, key, handler) => {
    const handlers = actionHandlers.current.get(id) ?? new Map();
    handlers.set(key, handler);
    actionHandlers.current.set(id, handlers);
    return () => {
      const current = actionHandlers.current.get(id);
      if (current?.get(key) !== handler) return;
      current.delete(key);
      if (!current.size) actionHandlers.current.delete(id);
    };
  }, []);
  const publishCanva = useCallback((job: CanvaTransferRuntime) => {
    const normalized = toCanvaTransfer(job);
    setTransfers((current) => [normalized, ...current.filter((transfer) => transfer.id !== job.id)]);
  }, []);

  const startCanvaTransfer = useCallback<TransferContextValue["startCanvaTransfer"]>((input) => {
    if (input.dedupeKey) {
      const existingId = dedupeJobs.current.get(input.dedupeKey);
      if (existingId) return existingId;
    }
    const job: CanvaTransferRuntime = { ...input, status: "queued", pageStatus: {}, controller: new AbortController() };
    jobs.current.set(job.id, job);
    if (job.dedupeKey) dedupeJobs.current.set(job.dedupeKey, job.id);
    publishCanva(job);
    const update = (patch: Partial<CanvaTransferRuntime>) => {
      const current = jobs.current.get(job.id);
      if (!current) return;
      Object.assign(current, patch);
      publishCanva(current);
    };
    registerTransferAction(job.id, "dismiss", () => {
      jobs.current.delete(job.id);
      unregisterTransferActions(job.id);
      setTransfers((current) => current.filter((transfer) => transfer.id !== job.id));
    });
    registerTransferAction(job.id, "cancel", () => {
      job.controller?.abort();
      if (job.status === "queued") {
        job.status = "cancelled";
        if (job.dedupeKey && dedupeJobs.current.get(job.dedupeKey) === job.id) dedupeJobs.current.delete(job.dedupeKey);
        job.error = "Canva import cancelled before it started.";
        publishCanva(job);
      }
    });
    registerTransferAction(job.id, "retry-cleanup", async () => {
      if (!job.cleanupRetry) return;
      job.cleanupRetryPending = true;
      publishCanva(job);
      try {
        await job.cleanupRetry();
        job.cleanupError = undefined;
        job.cleanupRetry = undefined;
      } catch (error) {
        job.cleanupError = error instanceof Error ? error.message : "Some files could not be removed. Try again.";
      } finally {
        job.cleanupRetryPending = false;
        publishCanva(job);
      }
    });
    registerTransferAction(job.id, "retry-custom-item", async () => {
      if (!job.customItemRetry) return;
      job.customItemRetryPending = true;
      publishCanva(job);
      try {
        const viewPath = await job.customItemRetry();
        job.customItemError = undefined;
        if (viewPath) job.viewPath = viewPath;
        job.status = job.failedPages?.length ? "partial" : "completed";
      } catch (error) {
        job.customItemError = error instanceof Error ? error.message : "Try again.";
      } finally {
        job.customItemRetryPending = false;
        publishCanva(job);
      }
    });
    const execute = async () => {
      const persistedPages = new Set<number>();
      try {
        if (job.status === "cancelled" || job.controller?.signal.aborted) throw new Error("Canva import cancelled.");
        job.status = "exporting";
        publishCanva(job);
        const result = await job.run(job.controller?.signal ?? new AbortController().signal, (event) => {
          if (event.type === "started") {
            update({ status: "exporting", pageStatus: Object.fromEntries((event.pages || job.pages).map((page) => [page, { status: "waiting" }])) });
          } else if (event.type === "page-progress") {
            const item = jobs.current.get(job.id);
            if (!item) return;
            const skipped = item.pageStatus[event.page]?.skipped || event.skipped === true;
            const requested = item.pageStatus[event.page]?.requested || (!skipped && (event.status === "exporting" || event.status === "processing" || event.exported === true));
            const hasStartedProcessing = item.status === "processing" || item.status === "finalizing" || (!skipped && (event.status === "processing" || event.status === "saving" || event.exported === true));
            item.status = hasStartedProcessing ? "processing" : "exporting";
            item.pageStatus = { ...item.pageStatus, [event.page]: {
              ...item.pageStatus[event.page],
              status: event.status === "ready" && !event.skipped ? "saving" : event.status,
              requested,
              ...(skipped ? { skipped: true } : {}),
            } };
            publishCanva(item);
          } else if (event.type === "finalizing") update({ status: "finalizing" });
        });
        update({ status: "finalizing" });
        const completion = await job.finalize(result, job.controller?.signal ?? new AbortController().signal, (pages) => {
          pages.forEach((page) => persistedPages.add(page));
          const item = jobs.current.get(job.id);
          if (!item) return;
          item.pageStatus = { ...item.pageStatus, ...Object.fromEntries(pages.map((page) => [page, { ...item.pageStatus[page], status: "ready", ...(!item.pageStatus[page]?.skipped ? { requested: true, processed: true } : {}) }])) };
          publishCanva(item);
        });
        if (job.controller?.signal.aborted) {
          const savedPages = persistedPages.size;
          update({ status: "cancelled", ...completion, error: `Import cancelled after saving ${savedPages} ${savedPages === 1 ? "page" : "pages"}. Saved Media and custom items remain available.`, pageStatus: Object.fromEntries(job.pages.map((page) => [page, { status: persistedPages.has(page) ? "ready" : "cancelled", ...(persistedPages.has(page) ? { requested: true, processed: true } : {}) }])) });
          return;
        }
        update({ status: completion.failedPages?.length || completion.customItemError ? "partial" : "completed", ...completion });
      } catch (error) {
        if (job.controller?.signal.aborted) {
          const savedPages = persistedPages.size;
          const cleanupMessage = error instanceof Error && /could not be removed/i.test(error.message) ? error.message : "";
          const cancellationMessage = savedPages
            ? `Import cancelled after saving ${savedPages} ${savedPages === 1 ? "page" : "pages"}. Saved Media remains available.`
            : "Import cancelled before any pages were saved.";
          update({ status: "cancelled", error: `${cancellationMessage}${cleanupMessage && !job.cleanupRetry ? ` ${cleanupMessage}` : ""}`, ...(cleanupMessage && job.cleanupRetry ? { cleanupError: cleanupMessage } : {}), pageStatus: Object.fromEntries(job.pages.map((page) => [page, { status: persistedPages.has(page) ? "ready" : "cancelled", ...(persistedPages.has(page) ? { requested: true, processed: true } : {}) }])) });
          return;
        }
        const savedPages = persistedPages.size;
        const message = formatCanvaImportError(error, job.format);
        const rawError = error instanceof Error ? error.message : "";
        update({
          status: savedPages ? "partial" : "failed",
          error: message,
          ...(job.cleanupRetry && /could not be removed/i.test(rawError) ? { cleanupError: rawError } : {}),
          pageStatus: Object.fromEntries(job.pages.map((page) => [page, { status: persistedPages.has(page) ? "ready" : "error", ...(persistedPages.has(page) ? { requested: true, processed: true } : {}) }])),
          failedPages: job.pages.filter((page) => !persistedPages.has(page)).map((page) => ({ page, error: message })),
        });
      } finally {
        if (job.dedupeKey && dedupeJobs.current.get(job.dedupeKey) === job.id) dedupeJobs.current.delete(job.dedupeKey);
      }
    };
    canvaQueue.current = canvaQueue.current.then(execute, execute);
    return job.id;
  }, [publishCanva, registerTransferAction, unregisterTransferActions]);

  const updateTransfer = useCallback((transfer: Transfer) => {
    setTransfers((current) => [transfer, ...current.filter((item) => item.id !== transfer.id)]);
  }, []);
  const removeTransfer = useCallback((id: string) => {
    unregisterTransferActions(id);
    setTransfers((current) => current.filter((item) => item.id !== id));
  }, [unregisterTransferActions]);

  const runTransferAction = useCallback<TransferContextValue["runTransferAction"]>(async (id, key) => {
    const handler = actionHandlers.current.get(id)?.get(key);
    if (handler) {
      await handler();
    } else if (key === "dismiss") {
      removeTransfer(id);
    }
  }, [removeTransfer]);

  useEffect(() => () => actionHandlers.current.clear(), []);

  useEffect(() => {
    const active = transfers.some((item) => item.blocksUnload && (item.status === "queued" || item.status === "active"));
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [transfers]);
  const minimizeTransfers = useCallback(() => setIsMinimized(true), []);
  const restoreTransfers = useCallback(() => setIsMinimized(false), []);
  const value = useMemo(() => ({ transfers, isMinimized, minimizeTransfers, restoreTransfers, startCanvaTransfer, updateTransfer, removeTransfer, registerTransferAction, runTransferAction }), [transfers, isMinimized, minimizeTransfers, restoreTransfers, startCanvaTransfer, updateTransfer, removeTransfer, registerTransferAction, runTransferAction]);
  const actionValue = useMemo(() => ({
    startCanvaTransfer,
    updateTransfer,
    removeTransfer,
    registerTransferAction,
    runTransferAction,
    getTransfer: (id: string) => transfersRef.current.find((transfer) => transfer.id === id),
  }), [startCanvaTransfer, updateTransfer, removeTransfer, registerTransferAction, runTransferAction]);
  return <TransferActionsContext.Provider value={actionValue}><TransferContext.Provider value={value}>{children}<TransferPanel transfers={transfers} isMinimized={isMinimized} onMinimize={minimizeTransfers} runTransferAction={runTransferAction} /></TransferContext.Provider></TransferActionsContext.Provider>;
};

export { getTransferOverview };
