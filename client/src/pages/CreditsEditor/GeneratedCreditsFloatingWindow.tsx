import { useEffect, useRef } from "react";
import { AlertCircle, Check, Circle, XCircle } from "lucide-react";
import { useDispatch, useSelector } from "../../hooks";
import FloatingWindow, {
  type FloatingWindowHandle,
} from "../../components/FloatingWindow/FloatingWindow";
import Spinner from "../../components/Spinner/Spinner";
import type { RootState } from "../../store/store";
import {
  clearGeneratedCredits,
  initialGeneratedCreditsState,
  setGeneratedCreditsDismissed,
  type GeneratedCreditItemStatus,
} from "../../store/generatedCreditsSlice";
import { getControllerRightPanelWidthPx } from "../../utils/controllerPanelLayout";
import { cn } from "../../utils/cnHelper";

const MARGIN = 16;

const StatusBadge = ({ status }: { status: GeneratedCreditItemStatus }) => {
  if (status === "updating") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-cyan-900/60 px-1 py-0.5 text-[10px] font-medium text-cyan-200">
        <Spinner width="10px" borderWidth="2px" />
        Updating
      </span>
    );
  }

  if (status === "updated") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-green-900/60 px-1 py-0.5 text-[10px] font-medium text-green-200">
        <Check size={10} />
        Updated
      </span>
    );
  }

  if (status === "current") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-700 px-1 py-0.5 text-[10px] font-medium text-zinc-200">
        <Check size={10} />
        Current
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-red-900/60 px-1 py-0.5 text-[10px] font-medium text-red-200">
        <XCircle size={10} />
        Error
      </span>
    );
  }

  if (status === "missed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-900/60 px-1 py-0.5 text-[10px] font-medium text-amber-200">
        <AlertCircle size={10} />
        Not placed
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-medium text-zinc-400">
      <Circle size={9} />
      Pending
    </span>
  );
};

const GeneratedCreditsFloatingWindow = () => {
  const dispatch = useDispatch();
  const floatingWindowRef = useRef<FloatingWindowHandle>(null);
  const activeItemRef = useRef<HTMLLIElement | null>(null);
  const state = useSelector(
    (s: RootState) => s.generatedCredits ?? initialGeneratedCreditsState,
  );
  const prevRestoreIdRef = useRef(state.restoreId);

  useEffect(() => {
    if (state.restoreId !== prevRestoreIdRef.current) {
      prevRestoreIdRef.current = state.restoreId;
      floatingWindowRef.current?.restore();
    }
  }, [state.restoreId]);

  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [state.activeCreditId]);

  if (state.dismissed || state.status === "idle") return null;

  const windowWidth = getControllerRightPanelWidthPx(window.innerWidth);
  const maxWindowHeight = Math.max(window.innerHeight - MARGIN * 2, 240);
  const defaultPosition = {
    x: Math.max(window.innerWidth - windowWidth - MARGIN, 0),
    y: MARGIN,
  };
  const isRunning = state.status === "running";
  const titleState =
    state.status === "running"
      ? "Updating"
      : state.status === "failed"
        ? "Failed"
        : "Complete";

  const handleClose = () => {
    dispatch(clearGeneratedCredits());
    dispatch(setGeneratedCreditsDismissed(true));
  };

  return (
    <FloatingWindow
      ref={floatingWindowRef}
      title={
        <span className="flex min-w-0 items-baseline gap-1.5 truncate">
          <span className="truncate">Generated Credits</span>
          <span className="shrink-0 text-[11px] font-normal text-zinc-400">
            ({titleState})
          </span>
        </span>
      }
      onClose={handleClose}
      defaultPosition={defaultPosition}
      defaultWidth={windowWidth}
      defaultHeight={maxWindowHeight}
      autoHeight
    >
      <div className="flex flex-col gap-3 text-sm text-white">
        {isRunning && state.totalSteps > 0 ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Spinner width="14px" borderWidth="2px" />
            <span>
              Step {Math.min(state.currentStep + 1, state.totalSteps)} of{" "}
              {state.totalSteps}
            </span>
          </div>
        ) : null}

        {state.warning ? (
          <p className="rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-200">
            {state.warning}
          </p>
        ) : null}

        {state.error ? (
          <p className="rounded bg-red-950/50 px-2 py-1 text-xs text-red-200">
            {state.error}
          </p>
        ) : null}

        {state.generatedAt ? (
          <p className="text-xs text-zinc-400">
            Generated {new Date(state.generatedAt).toLocaleString()}
          </p>
        ) : null}

        {state.items.length === 0 ? (
          <p className="text-zinc-400">No credit headings were filled.</p>
        ) : (
          <div className="rounded bg-zinc-950/40">
            <div className="bg-zinc-950/60 px-2 py-1">
              <span className="text-xs font-semibold tracking-wide text-white">
                Changes
              </span>
            </div>
            <ul className="divide-y divide-zinc-700">
              {state.items.map((item) => {
                const isActive = state.activeCreditId === item.creditId;
                const hasTextChange = item.previousText !== item.nextText;
                const isMissed = item.status === "missed";
                return (
                  <li
                    key={item.creditId}
                    ref={isActive ? activeItemRef : undefined}
                    className={cn(
                      "flex flex-col gap-2 px-2 py-1.5 transition-colors",
                      isActive && "bg-cyan-950/30",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="wrap-break-word text-xs font-medium text-zinc-100">
                          {item.creditHeading}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-400">
                          Source:{" "}
                          <span className="font-medium text-cyan-200">
                            {item.sourceLabel}
                          </span>
                        </div>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    {isMissed ? (
                      <>
                        <div className="rounded bg-amber-950/40 px-2 py-1 text-xs text-amber-100">
                          This scheduled role had assigned names, but no credit
                          heading matched it.
                        </div>
                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                            Scheduled names
                          </div>
                          <div className="wrap-break-word whitespace-pre-line text-xs text-zinc-200">
                            {item.nextText}
                          </div>
                        </div>
                      </>
                    ) : hasTextChange ? (
                      <>
                        {item.previousText.trim() ? (
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Before
                            </div>
                            <div className="wrap-break-word whitespace-pre-line text-xs text-zinc-500">
                              {item.previousText}
                            </div>
                          </div>
                        ) : null}
                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                            After
                          </div>
                          <div className="wrap-break-word whitespace-pre-line text-xs text-zinc-200">
                            {item.nextText}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded bg-zinc-900/70 px-2 py-1 text-xs text-zinc-300">
                        No change. This credit already matched the generated
                        text.
                      </div>
                    )}
                    {item.error ? (
                      <div className="text-xs text-red-300">{item.error}</div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </FloatingWindow>
  );
};

export default GeneratedCreditsFloatingWindow;
