import type { ConnectionStatus } from "../../context/controllerInfo";
import {
  BOOTSTRAP_LOADING_MESSAGES,
  RotatingLoadingMessage,
  STUCK_LOADING_MESSAGES,
  WorshipSyncLoadingContent,
} from "../LoadingScreenPresentation";
import { useStuckDbProgress } from "../../hooks/useStuckDbProgress";
import {
  DbStartupConnectionFailedPanel,
  DbStartupStuckRecoveryPanel,
} from "./DbProgressStartupRecoveryUi";

type ControllerLoadingOverlayProps = {
  dbProgress?: number;
  connectionStatus?: ConnectionStatus;
  user?: string;
  churchName?: string;
};

const ControllerLoadingOverlay = ({
  dbProgress = 0,
  connectionStatus,
}: ControllerLoadingOverlayProps) => {
  const isFailed = connectionStatus?.status === "failed";
  const isStuck = useStuckDbProgress(dbProgress, isFailed);

  if (dbProgress === 100) {
    if (!isFailed && connectionStatus?.status !== "retrying") return null;
    return (
      <div
        role={isFailed ? "alert" : "status"}
        className={`fixed top-0 inset-x-0 z-[60] border-b px-4 py-2 text-center text-sm text-white shadow-lg ${isFailed ? "border-red-400/40 bg-red-950" : "border-yellow-400/40 bg-yellow-950"}`}
      >
        {connectionStatus?.message || (isFailed
          ? "Sync stopped. Check your connection and reload to try again."
          : "Sync is reconnecting. New changes may be delayed.")}
      </div>
    );
  }

  return (
    <div
      data-testid="controller-loading-overlay"
      className="fixed inset-0 z-[60] flex h-dvh min-h-0 w-full flex-col items-center justify-center gap-6 bg-homepage-canvas px-4 text-white"
      aria-busy={!isFailed}
    >
      <WorshipSyncLoadingContent>
        {isFailed ? (
          <DbStartupConnectionFailedPanel message={connectionStatus?.message} />
        ) : (
          <>
            <RotatingLoadingMessage
              messages={
                isStuck ? STUCK_LOADING_MESSAGES : BOOTSTRAP_LOADING_MESSAGES
              }
            />
            {connectionStatus?.status === "retrying" && (
              <p className="text-sm text-yellow-300">
                Connection failed. Retrying...
              </p>
            )}
            {!isStuck && dbProgress > 0 && dbProgress < 100 && (
              <p className="text-xs text-gray-400">
                Database sync: {dbProgress}%
              </p>
            )}
            {isStuck && (
              <DbStartupStuckRecoveryPanel
                dbProgress={dbProgress}
                connectionStatus={connectionStatus}
              />
            )}
          </>
        )}
      </WorshipSyncLoadingContent>
    </div>
  );
};

export default ControllerLoadingOverlay;
