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
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, ChevronDown, ChevronUp, Presentation, X } from "lucide-react";
import Button from "../components/Button/Button";
import { useDispatch } from "../hooks";
import { setRequestOpenMediaPanel } from "../store/preferencesSlice";
import type { CanvaImportProgressEvent, CanvaImportResult } from "../api/canva";
import { formatCanvaImportError } from "../utils/canvaImportError";

type CanvaTransferStatus = "pending" | "exporting" | "processing" | "finalizing" | "completed" | "partial" | "failed" | "cancelled";
type CanvaTransfer = {
  id: string;
  kind: "canva";
  title: string;
  format: "png" | "mp4";
  pages: number[];
  status: CanvaTransferStatus;
  pageStatus: Record<number, string>;
  error?: string;
  importedCount?: number;
  viewPath?: string;
  failedPages?: Array<{ page: number; error: string }>;
  controller?: AbortController;
  run: (signal: AbortSignal, onProgress: (event: CanvaImportProgressEvent) => void) => Promise<CanvaImportResult>;
  finalize: (result: CanvaImportResult, signal: AbortSignal, onPagesPersisted: (pages: number[]) => void) => Promise<{ importedCount: number; viewPath?: string; failedPages?: CanvaImportResult["failedPages"] }>;
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

type TransferContextValue = {
  transfers: TransferItem[];
  startCanvaTransfer: (input: Omit<CanvaTransfer, "kind" | "status" | "pageStatus" | "controller">) => string;
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
  pending: "Starting Canva import…",
  exporting: "Requesting or preparing Canva export",
  processing: "Processing exported media",
  finalizing: "Saving presentation slides",
  completed: "Import complete",
  partial: "Import completed with some pages failed",
  failed: "Import failed",
  cancelled: "Import cancelled",
}[status]);

const TransferPanel = ({ transfers, setTransfers }: {
  transfers: TransferItem[];
  setTransfers: React.Dispatch<React.SetStateAction<TransferItem[]>>;
}) => {
  const [minimized, setMinimized] = useState(false);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const activeCount = transfers.filter((item) => item.kind === "upload"
    ? item.status === "uploading" || item.status === "processing"
    : !["completed", "partial", "failed", "cancelled"].includes(item.status)).length;

  const cancel = (job: CanvaTransfer) => {
    if (!window.confirm(`Cancel importing “${job.title}”? Pages already saved in Media will remain available.`)) return;
    job.controller?.abort();
  };

  const dismiss = (id: string) => setTransfers((current) => current.filter((item) => item.id !== id));

  if (!transfers.length) return null;
  return (
    <aside aria-label="Transfers" className="fixed bottom-4 right-4 z-[80] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-600 bg-gray-900 text-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Transfers</span>
          <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs" aria-label={`${activeCount} active transfers`}>{activeCount} active</span>
        </div>
        <div className="flex gap-1">
          <Button variant="tertiary" svg={minimized ? ChevronUp : ChevronDown} aria-label={minimized ? "Expand transfers" : "Minimize transfers"} onClick={() => setMinimized((value) => !value)} />
        </div>
      </div>
      {!minimized ? <ul className="max-h-[min(60vh,28rem)] space-y-2 overflow-y-auto p-2">
        {transfers.map((item) => {
          if (item.kind === "upload") return <li key={item.id} className="rounded-md bg-gray-800 p-3">
            <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{item.title}</p><span className="text-xs text-gray-300">{item.status === "completed" ? "Complete" : item.status === "failed" ? "Failed" : `${Math.round(item.progress)}%`}</span></div>
            <p className="mt-1 text-xs text-gray-300">{item.message}</p>
            {(item.status === "uploading" || item.status === "processing") ? <div className="mt-2 h-1.5 rounded bg-gray-700"><div className="h-1.5 rounded bg-cyan-500" style={{ width: `${item.progress}%` }} /></div> : null}
            {item.status === "completed" || item.status === "failed" ? <button className="mt-2 text-xs text-cyan-200 underline" onClick={() => dismiss(item.id)}>Dismiss</button> : null}
          </li>;
          const completedPages = Object.values(item.pageStatus).filter((status) => status === "ready").length;
          const percent = item.status === "completed" ? 100 : item.pages.length ? Math.min(95, Math.floor(completedPages / item.pages.length * 95)) : 0;
          const currentExportPage = item.pages.find((page) => item.pageStatus[page] === "exporting");
          const currentProcessingPage = item.pages.find((page) => item.pageStatus[page] === "processing" || item.pageStatus[page] === "saving");
          const progressLabel = currentExportPage
            ? `Exporting page ${currentExportPage} of ${item.pages.length}`
            : currentProcessingPage
              ? `Processing page ${currentProcessingPage} of ${item.pages.length}`
              : stageLabel(item.status);
          return <li key={item.id} className="rounded-md bg-gray-800 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2"><Presentation size={18} className="shrink-0 text-cyan-200" /><p className="truncate text-sm font-medium">{item.title}</p></div>
              {item.status === "completed" || item.status === "partial" || item.status === "failed" || item.status === "cancelled"
                ? <Button variant="tertiary" svg={X} aria-label={`Dismiss ${item.title}`} onClick={() => dismiss(item.id)} />
                : <Button variant="tertiary" svg={X} aria-label={`Cancel ${item.title}`} onClick={() => cancel(item)} />}
            </div>
            <p className="mt-1 text-xs text-gray-300">{progressLabel}</p>
            <p className="mt-1 text-xs text-gray-300">{completedPages} of {item.pages.length} pages processed</p>
            {item.status !== "failed" && item.status !== "cancelled" ? <div className="mt-2 h-1.5 rounded bg-gray-700"><div className="h-1.5 rounded bg-cyan-500 transition-[width]" style={{ width: `${percent}%` }} /></div> : null}
            {item.error ? <p role="alert" className="mt-2 text-xs text-red-200">{item.error}</p> : null}
            {item.failedPages?.length ? <div role="alert" className="mt-2 text-xs text-amber-200">{item.failedPages.map(({ page, error }) => `Page ${page}: ${error}`).join(" ")} Reopen the Canva import to retry these pages.</div> : null}
            {item.status === "completed" || item.status === "partial" ? <div className="mt-2 flex items-center justify-between text-xs"><span>{item.importedCount} slides imported</span><button className="flex items-center gap-1 text-cyan-200 underline" onClick={() => {
              if (item.viewPath) navigate(item.viewPath);
              else { dispatch(setRequestOpenMediaPanel(true)); navigate("/controller"); }
            }}><ArrowUpRight size={14} />View presentation</button></div> : null}
          </li>;
        })}
      </ul> : <button className="w-full px-3 py-2 text-left text-xs text-gray-300" onClick={() => setMinimized(false)}>{activeCount ? `${activeCount} active transfer${activeCount === 1 ? "" : "s"}` : "Recent transfers"} · Expand</button>}
    </aside>
  );
};

export const TransferProvider = ({ children }: { children: ReactNode }) => {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const canvaQueue = useRef(Promise.resolve());
  const startCanvaTransfer = useCallback<TransferContextValue["startCanvaTransfer"]>((input) => {
    const controller = new AbortController();
    const job: CanvaTransfer = { ...input, kind: "canva", status: "pending", pageStatus: {}, controller };
    setTransfers((current) => [job, ...current]);
    const update = (patch: Partial<CanvaTransfer>) => setTransfers((current) => current.map((item) => item.id === job.id && item.kind === "canva" ? { ...item, ...patch } : item));
    const execute = async () => {
      try {
        if (controller.signal.aborted) throw new Error("Canva import cancelled.");
        const result = await job.run(controller.signal, (event) => {
          if (event.type === "started") update({ status: "exporting", pageStatus: Object.fromEntries((event.pages || job.pages).map((page) => [page, "waiting"])) });
          else if (event.type === "page-progress") {
            update({ status: event.status === "exporting" ? "exporting" : "processing" });
            setTransfers((current) => current.map((item) => item.id === job.id && item.kind === "canva"
              ? { ...item, pageStatus: { ...item.pageStatus, [event.page]: event.status === "ready" ? "saving" : event.status } }
              : item));
          }
          else if (event.type === "finalizing") update({ status: "finalizing" });
        });
        if (controller.signal.aborted) {
          update({ status: "cancelled", controller: undefined });
          return;
        }
        update({ status: "finalizing" });
        const completion = await job.finalize(result, controller.signal, (pages) => setTransfers((current) => current.map((item) => item.id === job.id && item.kind === "canva"
          ? { ...item, pageStatus: { ...item.pageStatus, ...Object.fromEntries(pages.map((page) => [page, "ready"])) } }
          : item)));
        if (!controller.signal.aborted) update({ status: completion.failedPages?.length ? "partial" : "completed", ...completion, controller: undefined });
      } catch (error) {
        if (controller.signal.aborted) {
          update({ status: "cancelled", controller: undefined });
          return;
        }
        update({ status: "failed", error: formatCanvaImportError(error, job.format), controller: undefined });
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
  const value = useMemo(() => ({ transfers, startCanvaTransfer, updateUploadTransfer }), [transfers, startCanvaTransfer, updateUploadTransfer]);
  return <TransferContext.Provider value={value}>{children}<TransferPanel transfers={transfers} setTransfers={setTransfers} /></TransferContext.Provider>;
};
