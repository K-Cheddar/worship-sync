import { useMemo } from "react";
import {
  BOOTSTRAP_LOADING_MESSAGES,
  RotatingLoadingMessage,
  WorshipSyncLoadingContent,
} from "../LoadingScreenPresentation";
import { useSlowStartupMessage } from "../../hooks/useSlowStartupMessage";
import {
  DbStartupLoadingDetails,
  DbStartupFailurePanel,
  getStartupStageLabel,
} from "./DbStartupStatusUi";
import type {
  ConnectionStatus,
  ControllerStartupInfo,
  StartupActivitySubscription,
  StartupFailure,
} from "../../context/controllerInfo";

type ControllerLoadingOverlayProps = {
  dbProgress?: number | null;
  connectionStatus?: ConnectionStatus;
  startupInfo?: ControllerStartupInfo;
  subscribeToStartupActivity?: StartupActivitySubscription;
  user?: string;
  churchName?: string;
};

const ControllerLoadingOverlay = ({
  dbProgress = null,
  connectionStatus,
  startupInfo,
  subscribeToStartupActivity,
}: ControllerLoadingOverlayProps) => {
  const fallbackStartupInfo = useMemo(() => {
    const now = Date.now();
    return {
      stage: "connecting-to-server" as const,
      startedAt: now,
      lastMeaningfulActivityAt: now,
      failure: null,
    };
  }, []);
  const currentStartupInfo = startupInfo ?? fallbackStartupInfo;
  const isComplete = dbProgress === 100 || currentStartupInfo.stage === "completed";
  const fallbackFailure: StartupFailure | null =
    connectionStatus?.status === "failed" && !isComplete
      ? {
          kind: "server-connection",
          message:
            connectionStatus.message ||
            "Check your network connection, then reload WorshipSync to try again.",
        }
      : null;
  const failure = currentStartupInfo.failure ?? fallbackFailure;
  const showSlowStartupMessage = useSlowStartupMessage(
    currentStartupInfo.lastMeaningfulActivityAt,
    isComplete || Boolean(failure),
    subscribeToStartupActivity,
  );

  if (dbProgress === 100) {
    if (!failure && connectionStatus?.status !== "retrying" && connectionStatus?.status !== "failed") return null;
    return (
      <div
        role={connectionStatus?.status === "failed" ? "alert" : "status"}
        className={`fixed top-0 inset-x-0 z-[60] border-b px-4 py-2 text-center text-sm text-white shadow-lg ${connectionStatus?.status === "failed" ? "border-red-400/40 bg-red-950" : "border-yellow-400/40 bg-yellow-950"}`}
      >
        {connectionStatus?.message ||
          (connectionStatus?.status === "failed"
            ? "Sync stopped. Check your connection and reload to try again."
            : "Sync is reconnecting. New changes may be delayed.")}
      </div>
    );
  }

  return (
    <div
      data-testid="controller-loading-overlay"
      className="fixed inset-0 z-[60] flex h-dvh min-h-0 w-full flex-col items-center justify-center gap-6 bg-homepage-canvas/85 px-4 text-white backdrop-blur-[2px]"
      aria-busy={!failure}
    >
      <WorshipSyncLoadingContent>
        {failure ? (
          <DbStartupFailurePanel
            failure={failure}
            startupInfo={currentStartupInfo}
            dbProgress={dbProgress}
            connectionStatus={connectionStatus}
          />
        ) : (
          <>
            <p data-testid="startup-stage" className="text-sm leading-5 text-gray-200">
              {getStartupStageLabel(currentStartupInfo.stage)}
            </p>
            <RotatingLoadingMessage messages={BOOTSTRAP_LOADING_MESSAGES} />
            {connectionStatus?.status === "retrying" && (
              <p role="status" className="text-sm text-yellow-300">
                Reconnecting to the server… WorshipSync will automatically try again.
              </p>
            )}
            {dbProgress !== null && dbProgress < 100 && (
              <p className="text-xs text-gray-400">
                Database sync: {dbProgress}%
              </p>
            )}
            {showSlowStartupMessage && (
              <p role="status" aria-live="polite" className="max-w-lg text-center text-sm">
                This is taking a little longer than usual. Please keep this
                window open while WorshipSync gets everything ready.
              </p>
            )}
            <DbStartupLoadingDetails
              startupInfo={currentStartupInfo}
              dbProgress={dbProgress}
              connectionStatus={connectionStatus}
            />
          </>
        )}
      </WorshipSyncLoadingContent>
    </div>
  );
};

export default ControllerLoadingOverlay;
