import { useRef } from "react";
import { useDispatch, useSelector } from "../../hooks";
import { clearServicePlanningSyncState } from "../../store/servicePlanningImportSlice";
import type { RootState } from "../../store/store";
import FloatingWindow from "../../components/FloatingWindow/FloatingWindow";
import Spinner from "../../components/Spinner/Spinner";

const MAX_WINDOW_WIDTH = Math.min(340, window.innerWidth);
const MARGIN = 16;

const ServicePlanningSyncFloatingWindow = () => {
  const dispatch = useDispatch();
  const sync = useSelector((s: RootState) => s.servicePlanningImport.sync);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isVisible = sync.status !== "idle";

  // Computed fresh when the window first becomes visible so window.innerWidth is current.
  const windowWidth = Math.min(MAX_WINDOW_WIDTH, window.innerWidth);
  const positionRef = useRef({
    x: Math.max(window.innerWidth - windowWidth - MARGIN, 0),
    y: MARGIN,
  });

  if (!isVisible) return null;

  const isRunning = sync.status === "running";
  const isFailed = sync.status === "failed";
  const isDone = sync.status === "completed";

  const title = isRunning
    ? `Syncing ${sync.phase === "overlays" ? "overlays" : "outline"}…`
    : isFailed
      ? "Sync failed"
      : "Sync complete";

  const handleClose = () => {
    if (autoCloseRef.current !== null) clearTimeout(autoCloseRef.current);
    dispatch(clearServicePlanningSyncState());
  };

  return (
    <FloatingWindow
      title={title}
      onClose={handleClose}
      defaultPosition={positionRef.current}
      defaultWidth={windowWidth}
      defaultHeight={window.innerHeight - MARGIN * 2}
      autoHeight
    >
      <div className="flex flex-col gap-2 text-sm text-white">
        {isFailed && (
          <p className="text-red-400">{sync.error || "Try again."}</p>
        )}

        {isRunning && sync.totalSteps > 0 && (
          <div className="flex items-center gap-2 text-zinc-400 text-xs">
            <Spinner width="14px" borderWidth="2px" />
            <span>
              Step {Math.min(sync.currentStep + 1, sync.totalSteps)} of{" "}
              {sync.totalSteps}
            </span>
          </div>
        )}

        {sync.syncItems.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {sync.syncItems.map((item, i) => {
              const isActive =
                isRunning &&
                item.status === "pending" &&
                item.label === sync.activeLabel;
              if (item.status === "pending" && !isActive) return null;
              return (
                <li key={i} className="flex items-start gap-2">
                  {isActive ? (
                    <Spinner width="14px" borderWidth="2px" className="mt-0.5 shrink-0" />
                  ) : (
                    <span className={item.status === "updated" ? "mt-0.5 shrink-0 text-green-400" : "mt-0.5 shrink-0 text-zinc-500"}>✓</span>
                  )}
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="wrap-break-word leading-snug">{item.label}</span>
                      {item.status === "updated" && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-green-900/60 text-green-300">Updated</span>
                      )}
                      {item.status === "created" && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-blue-900/60 text-blue-300">Created</span>
                      )}
                      {item.status === "added" && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-cyan-900/60 text-cyan-300">Added</span>
                      )}
                      {item.status === "already-present" && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-zinc-700 text-zinc-400">Already present</span>
                      )}
                    </span>
                    {item.sublabel && (
                      <span className="text-xs text-zinc-400 leading-snug">{item.sublabel}</span>
                    )}
                    {isActive && sync.activeSublabel && (
                      <span className="text-xs text-zinc-400 leading-snug">{sync.activeSublabel}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {isDone && sync.syncItems.length === 0 && !isFailed && (
          <p className="text-zinc-400">Nothing to update.</p>
        )}
      </div>
    </FloatingWindow>
  );
};

export default ServicePlanningSyncFloatingWindow;
