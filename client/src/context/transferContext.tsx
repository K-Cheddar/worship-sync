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
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronDown, Presentation, X } from "lucide-react";
import Button from "../components/Button/Button";
import Modal from "../components/Modal/Modal";
import type { CanvaImportProgressEvent, CanvaImportResult } from "../api/canva";
import { formatCanvaImportError } from "../utils/canvaImportError";

type CanvaTransferStatus = "pending" | "exporting" | "processing" | "finalizing" | "completed" | "partial" | "failed" | "cancelled";
type CanvaPageState = {
  status: "waiting" | "exporting" | "processing" | "saving" | "ready" | "error" | "cancelled";
  requested?: boolean;
  processed?: boolean;
  skipped?: boolean;
};
type CanvaTransfer = {
  id: string;
  kind: "canva";
  title: string;
  format: "png" | "mp4";
  pages: number[];
  status: CanvaTransferStatus;
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

type UploadTransfer = {
  id: string;
  kind: "upload";
  title: string;
  status: "uploading" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
};
export type TransferItem = CanvaTransfer | UploadTransfer;

const terminalCanvaStatuses: CanvaTransferStatus[] = ["completed", "partial", "failed", "cancelled"];
const isActiveTransfer = (item: TransferItem) => item.kind === "upload"
  ? item.status === "uploading" || item.status === "processing"
  : !terminalCanvaStatuses.includes(item.status);

const getCanvaProgressCounts = (item: CanvaTransfer) => ({
  totalPages: item.pages.filter((page) => !item.pageStatus[page]?.skipped).length,
  requestedPages: item.pages.filter((page) => item.pageStatus[page]?.requested && !item.pageStatus[page]?.skipped).length,
  processedPages: item.pages.filter((page) => item.pageStatus[page]?.processed && !item.pageStatus[page]?.skipped).length,
});

const getCanvaTransferProgress = (item: CanvaTransfer) => {
  const { totalPages, requestedPages, processedPages } = getCanvaProgressCounts(item);
  return totalPages ? ((requestedPages + processedPages) / (totalPages * 2)) * 100 : 100;
};

const getTransferProgress = (item: TransferItem) => {
  const progress = item.kind === "upload" ? item.progress : getCanvaTransferProgress(item);
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
};

export type ActiveTransferSummary = {
  id: string;
  name: string;
  type?: string;
  status: string;
  progress: number;
};

const getCanvaTransferPhase = (item: CanvaTransfer) => {
  const { totalPages, requestedPages, processedPages } = getCanvaProgressCounts(item);
  const hasStartedProcessing = item.status === "processing" || item.status === "finalizing" || Object.values(item.pageStatus).some((page) => ["processing", "saving"].includes(page.status) || (page.status === "ready" && !page.skipped));
  if (hasStartedProcessing) return `Processing Canva pages · ${processedPages} of ${totalPages}`;
  if (item.pageStatus && item.pages.some((page) => item.pageStatus[page]?.status === "exporting")) {
    return `Requesting page ${requestedPages} of ${totalPages}`;
  }
  const waitingPage = item.pages.find((page) => item.pageStatus[page]?.status === "waiting");
  if (waitingPage) return `Waiting for Canva to prepare export · page ${waitingPage} of ${totalPages}`;
  return stageLabel(item.status);
};

export const getTransferOverview = (transfers: TransferItem[]) => {
  const activeTransfers = transfers.filter(isActiveTransfer);
  const summaries: ActiveTransferSummary[] = activeTransfers.map((item) => ({
    id: item.id,
    name: item.title,
    ...(item.kind === "canva" ? { type: "Canva" } : {}),
    status: item.kind === "canva"
      ? getCanvaTransferPhase(item)
      : item.status === "processing" ? "Processing" : "Uploading",
    progress: getTransferProgress(item),
  }));
  const progress = summaries.length
    ? summaries.reduce((sum, item) => sum + item.progress, 0) / summaries.length
    : null;
  return { activeCount: summaries.length, progress, transfers: summaries };
};

type TransferContextValue = {
  transfers: TransferItem[];
  isMinimized: boolean;
  minimizeTransfers: () => void;
  restoreTransfers: () => void;
  startCanvaTransfer: (input: Omit<CanvaTransfer, "kind" | "status" | "pageStatus" | "controller" | "customItemRetryPending" | "cleanupRetryPending" | "cleanupError">) => string;
  updateUploadTransfer: (item: UploadTransfer | null) => void;
};

const TransferContext = createContext<TransferContextValue | null>(null);
export const useTransfers = () => {
  const context = useContext(TransferContext);
  if (!context) throw new Error("Transfer panel is unavailable.");
  return context;
};
export const useOptionalTransfers = () => useContext(TransferContext);

const stageLabel = (status: CanvaTransferStatus) => ({
  pending: "Preparing Canva import…",
  exporting: "Requesting Canva export…",
  processing: "Processing exported media",
  finalizing: "Saving presentation slides",
  completed: "Import complete",
  partial: "Import completed with some pages failed",
  failed: "Import failed",
  cancelled: "Import cancelled",
}[status]);

const TransferPanel = ({ transfers, setTransfers, isMinimized, onMinimize }: {
  transfers: TransferItem[];
  setTransfers: React.Dispatch<React.SetStateAction<TransferItem[]>>;
  isMinimized: boolean;
  onMinimize: () => void;
}) => {
  const [transferToCancel, setTransferToCancel] = useState<CanvaTransfer | null>(null);
  const { activeCount } = getTransferOverview(transfers);

  const cancel = (job: CanvaTransfer) => {
    setTransferToCancel(job);
  };

  const dismiss = (id: string) => setTransfers((current) => current.filter((item) => item.id !== id));

  if (!transfers.length || isMinimized) return null;
  return (
    <>
    <aside aria-label="Transfers" className="fixed bottom-4 right-4 z-[80] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-600 bg-gray-900 text-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Transfers</span>
          <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs" aria-label={`${activeCount} active transfers`}>{activeCount} active</span>
        </div>
        <div className="flex gap-1">
          <Button variant="tertiary" svg={ChevronDown} aria-label="Minimize transfers" onClick={onMinimize} />
        </div>
      </div>
      <ul className="max-h-[min(60vh,28rem)] space-y-2 overflow-y-auto p-2">
        {transfers.map((item) => {
          if (item.kind === "upload") return <li key={item.id} className="rounded-md bg-gray-800 p-3">
            <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{item.title}</p><span className="text-xs text-gray-300">{item.status === "completed" ? "Complete" : item.status === "failed" ? "Failed" : `${Math.round(item.progress)}%`}</span></div>
            <p className="mt-1 text-xs text-gray-300">{item.message}</p>
            {(item.status === "uploading" || item.status === "processing") ? <div className="mt-2 h-1.5 rounded bg-gray-700"><div className="h-1.5 rounded bg-cyan-500" style={{ width: `${item.progress}%` }} /></div> : null}
            {item.status === "completed" || item.status === "failed" ? <button className="mt-2 text-xs text-cyan-200 underline" onClick={() => dismiss(item.id)}>Dismiss</button> : null}
          </li>;
          const { totalPages, requestedPages, processedPages } = getCanvaProgressCounts(item);
          const progress = getCanvaTransferProgress(item);
          const percent = item.status === "completed" || item.status === "partial"
            ? 100
            : Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : undefined;
          const currentExportPage = item.pages.find((page) => item.pageStatus[page]?.status === "exporting");
          const currentWaitingPage = item.pages.find((page) => item.pageStatus[page]?.status === "waiting");
          const isPageProcessing = item.status === "processing" || item.status === "finalizing" || Object.values(item.pageStatus).some((page) => ["processing", "saving"].includes(page.status) || (page.status === "ready" && !page.skipped));
          const hasPageProgress = isPageProcessing || Object.values(item.pageStatus).some((page) => page.status === "error");
          const isTerminal = ["completed", "partial", "failed", "cancelled"].includes(item.status);
          const progressLabel = isTerminal
            ? item.customItemError ? "Media imported; custom item needs attention" : stageLabel(item.status)
            : item.customItemError
              ? "Media imported; custom item needs attention"
              : isPageProcessing
                ? `Processing Canva pages · ${processedPages} of ${totalPages}`
                : currentExportPage
                  ? `Requesting Canva export · page ${requestedPages} of ${totalPages}`
                  : currentWaitingPage
                    ? `Waiting for Canva to prepare export · page ${currentWaitingPage} of ${item.pages.length}`
                    : stageLabel(item.status);
          return <li key={item.id} className="rounded-md bg-gray-800 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2"><Presentation size={18} className="shrink-0 text-cyan-200" /><p className="truncate text-sm font-medium">{item.title}</p></div>
              {item.status === "completed" || item.status === "partial" || item.status === "failed" || item.status === "cancelled"
                ? <Button variant="tertiary" svg={X} aria-label={`Dismiss ${item.title}`} onClick={() => dismiss(item.id)} />
                : <Button variant="tertiary" svg={X} aria-label={`Cancel ${item.title}`} onClick={() => cancel(item)} />}
            </div>
            <p className="mt-1 text-xs text-gray-300">{progressLabel}</p>
            {hasPageProgress && <p className="mt-1 text-xs text-gray-300">{processedPages} of {totalPages} pages processed{item.status === "completed" || percent === undefined ? "" : ` · ${Math.round(percent)}%`}</p>}
            {item.status !== "failed" && item.status !== "cancelled" ? <div role="progressbar" aria-label={`${item.title} progress`} aria-valuemin={0} aria-valuemax={100} {...(item.status !== "pending" && percent !== undefined ? { "aria-valuenow": percent } : {})} className="mt-2 h-1.5 overflow-hidden rounded bg-gray-700">{item.status !== "pending"
              ? percent === undefined
                ? <div className="h-full w-1/3 animate-pulse rounded bg-cyan-500" />
                : <div className="h-1.5 rounded bg-cyan-500 transition-[width]" style={{ width: `${percent}%` }} />
              : <div className="h-full w-1/3 animate-pulse rounded bg-cyan-500" />}</div> : null}
            {item.error ? <p role="alert" className="mt-2 text-xs text-red-200">{item.error}</p> : null}
            {item.cleanupError ? <div role="alert" className="mt-2 text-xs text-amber-200">Some unused Canva files still need cleanup. {item.cleanupError}
              {item.cleanupRetry ? <button className="ml-1 text-cyan-200 underline disabled:opacity-50" disabled={item.cleanupRetryPending} onClick={async () => {
                setTransfers((current) => current.map((transfer) => transfer.id === item.id && transfer.kind === "canva" ? { ...transfer, cleanupRetryPending: true } : transfer));
                try {
                  await item.cleanupRetry?.();
                  setTransfers((current) => current.map((transfer) => transfer.id === item.id && transfer.kind === "canva" ? { ...transfer, cleanupError: undefined, cleanupRetry: undefined, cleanupRetryPending: false } : transfer));
                } catch (retryError) {
                  setTransfers((current) => current.map((transfer) => transfer.id === item.id && transfer.kind === "canva" ? { ...transfer, cleanupError: retryError instanceof Error ? retryError.message : "Some files could not be removed. Try again.", cleanupRetryPending: false } : transfer));
                }
              }}>{item.cleanupRetryPending ? "Cleaning up…" : "Retry cleanup"}</button> : null}
            </div> : null}
            {item.customItemError ? <div role="alert" className="mt-2 text-xs text-amber-200">Media was imported, but the custom item was not created. {item.customItemError}
              {item.customItemRetry ? <button className="ml-1 text-cyan-200 underline disabled:opacity-50" disabled={item.customItemRetryPending} onClick={async () => {
                setTransfers((current) => current.map((transfer) => transfer.id === item.id && transfer.kind === "canva" ? { ...transfer, customItemRetryPending: true } : transfer));
                try {
                  const viewPath = await item.customItemRetry?.();
                  setTransfers((current) => current.map((transfer) => transfer.id === item.id && transfer.kind === "canva" ? { ...transfer, status: transfer.failedPages?.length ? "partial" : "completed", customItemError: undefined, customItemRetryPending: false, ...(viewPath ? { viewPath } : {}) } : transfer));
                } catch (retryError) {
                  setTransfers((current) => current.map((transfer) => transfer.id === item.id && transfer.kind === "canva" ? { ...transfer, customItemError: retryError instanceof Error ? retryError.message : "Try again.", customItemRetryPending: false } : transfer));
                }
              }}>{item.customItemRetryPending ? "Creating…" : "Retry custom item"}</button> : null}
            </div> : null}
            {item.failedPages?.length ? <div role="alert" className="mt-2 text-xs text-amber-200">{item.failedPages.map(({ page, error }) => `Page ${page}: ${error}`).join(" ")} Reopen the Canva import to retry these pages.</div> : null}
            {item.status === "completed" || item.status === "partial" || (item.status === "cancelled" && Boolean(item.importedCount || item.viewPath)) ? <div className="mt-2 flex items-center justify-between text-xs"><span>{item.importedCount} slides imported</span>{item.viewPath ? <Link to={item.viewPath} className="flex cursor-pointer items-center gap-1 rounded text-cyan-200 underline outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"><ArrowUpRight size={14} />View presentation</Link> : null}</div> : null}
          </li>;
        })}
      </ul>
    </aside>
    <Modal
      isOpen={Boolean(transferToCancel)}
      onClose={() => setTransferToCancel(null)}
      title="Cancel this import?"
      description={transferToCancel ? `Cancel importing “${transferToCancel.title}”? Pages already saved in Media will remain available.` : undefined}
      size="sm"
    >
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setTransferToCancel(null)}>Keep importing</Button>
        <Button onClick={() => {
          transferToCancel?.controller?.abort();
          setTransferToCancel(null);
        }}>Cancel import</Button>
      </div>
    </Modal>
    </>
  );
};

export const TransferProvider = ({ children }: { children: ReactNode }) => {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const canvaQueue = useRef(Promise.resolve());
  const queuedCanvaJobs = useRef(new Map<string, string>());
  const startCanvaTransfer = useCallback<TransferContextValue["startCanvaTransfer"]>((input) => {
    if (input.dedupeKey) {
      const existingId = queuedCanvaJobs.current.get(input.dedupeKey);
      if (existingId) return existingId;
    }
    const controller = new AbortController();
    const job: CanvaTransfer = { ...input, kind: "canva", status: "pending", pageStatus: {}, controller };
    if (input.dedupeKey) queuedCanvaJobs.current.set(input.dedupeKey, job.id);
    setTransfers((current) => [job, ...current]);
    const update = (patch: Partial<CanvaTransfer>) => setTransfers((current) => current.map((item) => item.id === job.id && item.kind === "canva" ? { ...item, ...patch } : item));
    const execute = async () => {
      const persistedPages = new Set<number>();
      try {
        if (controller.signal.aborted) throw new Error("Canva import cancelled.");
        const result = await job.run(controller.signal, (event) => {
          if (event.type === "started") update({ status: "exporting", pageStatus: Object.fromEntries((event.pages || job.pages).map((page) => [page, { status: "waiting" }])) });
          else if (event.type === "page-progress") {
            setTransfers((current) => current.map((item) => {
              if (item.id !== job.id || item.kind !== "canva") return item;
              const skipped = item.pageStatus[event.page]?.skipped || event.skipped === true;
              const requested = item.pageStatus[event.page]?.requested || (!skipped && (event.status === "exporting" || event.status === "processing" || event.exported === true));
              const hasStartedProcessing = item.status === "processing" || item.status === "finalizing" || (!skipped && (event.status === "processing" || event.status === "saving" || event.exported === true));
              return {
                ...item,
                status: hasStartedProcessing ? "processing" : "exporting",
                pageStatus: { ...item.pageStatus, [event.page]: {
                  ...item.pageStatus[event.page],
                  status: event.status === "ready" && !event.skipped ? "saving" : event.status,
                  requested,
                  ...(skipped ? { skipped: true } : {}),
                } },
              };
            }));
          }
          else if (event.type === "finalizing") update({ status: "finalizing" });
        });
        update({ status: "finalizing" });
        const completion = await job.finalize(result, controller.signal, (pages) => {
          pages.forEach((page) => persistedPages.add(page));
          setTransfers((current) => current.map((item) => item.id === job.id && item.kind === "canva"
            ? { ...item, pageStatus: { ...item.pageStatus, ...Object.fromEntries(pages.map((page) => [page, { ...item.pageStatus[page], status: "ready", ...(!item.pageStatus[page]?.skipped ? { requested: true, processed: true } : {}) }])) } }
            : item));
        });
        if (controller.signal.aborted) {
          const savedPages = persistedPages.size;
          update({ status: "cancelled", ...completion, error: `Import cancelled after saving ${savedPages} ${savedPages === 1 ? "page" : "pages"}. Saved Media and custom items remain available.`, pageStatus: Object.fromEntries(job.pages.map((page) => [page, { status: persistedPages.has(page) ? "ready" : "cancelled", ...(persistedPages.has(page) ? { requested: true, processed: true } : {}) }])), controller: undefined });
          return;
        }
        update({ status: completion.failedPages?.length || completion.customItemError ? "partial" : "completed", ...completion, controller: undefined });
      } catch (error) {
        if (controller.signal.aborted) {
          const savedPages = persistedPages.size;
          const cleanupMessage = error instanceof Error && /could not be removed/i.test(error.message) ? error.message : "";
          const cancellationMessage = savedPages
            ? `Import cancelled after saving ${savedPages} ${savedPages === 1 ? "page" : "pages"}. Saved Media remains available.`
            : "Import cancelled before any pages were saved.";
          update({ status: "cancelled", error: `${cancellationMessage}${cleanupMessage && !job.cleanupRetry ? ` ${cleanupMessage}` : ""}`, ...(cleanupMessage && job.cleanupRetry ? { cleanupError: cleanupMessage, cleanupRetry: job.cleanupRetry } : {}), pageStatus: Object.fromEntries(job.pages.map((page) => [page, { status: persistedPages.has(page) ? "ready" : "cancelled", ...(persistedPages.has(page) ? { requested: true, processed: true } : {}) }])), controller: undefined });
          return;
        }
        const savedPages = persistedPages.size;
        const message = formatCanvaImportError(error, job.format);
        const rawError = error instanceof Error ? error.message : "";
        update({
          status: savedPages ? "partial" : "failed",
          error: message,
          ...(job.cleanupRetry && /could not be removed/i.test(rawError) ? { cleanupError: rawError, cleanupRetry: job.cleanupRetry } : {}),
          pageStatus: Object.fromEntries(job.pages.map((page) => [page, { status: persistedPages.has(page) ? "ready" : "error", ...(persistedPages.has(page) ? { requested: true, processed: true } : {}) }])),
          failedPages: job.pages.filter((page) => !persistedPages.has(page)).map((page) => ({ page, error: message })),
          controller: undefined,
        });
      } finally {
        if (job.dedupeKey && queuedCanvaJobs.current.get(job.dedupeKey) === job.id) {
          queuedCanvaJobs.current.delete(job.dedupeKey);
        }
      }
    };
    canvaQueue.current = canvaQueue.current.then(execute, execute);
    return job.id;
  }, []);
  const updateUploadTransfer = useCallback((item: UploadTransfer | null) => setTransfers((current) => item ? [...current.filter((existing) => existing.id !== item.id), item] : current), []);
  useEffect(() => {
    const active = transfers.some((item) => item.kind === "canva" && !["completed", "partial", "failed", "cancelled"].includes(item.status));
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [transfers]);
  const minimizeTransfers = useCallback(() => setIsMinimized(true), []);
  const restoreTransfers = useCallback(() => setIsMinimized(false), []);
  const value = useMemo(() => ({ transfers, isMinimized, minimizeTransfers, restoreTransfers, startCanvaTransfer, updateUploadTransfer }), [transfers, isMinimized, minimizeTransfers, restoreTransfers, startCanvaTransfer, updateUploadTransfer]);
  return <TransferContext.Provider value={value}>{children}<TransferPanel transfers={transfers} setTransfers={setTransfers} isMinimized={isMinimized} onMinimize={minimizeTransfers} /></TransferContext.Provider>;
};
