import Spinner from "../Spinner/Spinner";
import { ConnectionStatus } from "../../context/controllerInfo";
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
  user,
  churchName,
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

  const displayName = user?.trim() ?? "";
  const displayChurch = churchName?.trim() ?? "";

  const welcomeLead =
    displayName.length > 0 ? (
      <>
        Welcome, <span className="font-semibold">{displayName}</span>.
      </>
    ) : (
      <>Welcome.</>
    );

  const readinessLead =
    displayChurch.length > 0 ? (
      <>
        is setting the stage for{" "}
        <span className="font-semibold">{displayChurch}</span> now.
      </>
    ) : (
      <>is setting the stage for you now.</>
    );

  return (
    <div className="fixed top-0 left-0 z-50 w-full h-full bg-homepage-canvas/90 flex justify-center items-center flex-col text-white text-2xl gap-8">
      {isFailed ? (
        <>
          {connectionStatus?.message && (
            <p role="alert" className="max-w-lg px-4 text-center text-base text-red-200">
              {connectionStatus.message}
            </p>
          )}
          <DbStartupConnectionFailedPanel />
        </>
      ) : isStuck ? (
        <>
          <DbStartupStuckRecoveryPanel
            dbProgress={dbProgress}
            connectionStatus={connectionStatus}
          />
          {connectionStatus?.status === "retrying" && (
            <p className="text-center text-lg text-yellow-400">
              Connection failed. Retrying...
            </p>
          )}
          <Spinner />
        </>
      ) : (
        <>
          <p className="max-w-lg px-4 text-center">
            {welcomeLead}{" "}
            <span className="font-bold">Worship</span>
            <span className="text-orange-500 font-semibold">Sync</span>{" "}
            {readinessLead}
          </p>
          {connectionStatus?.status === "retrying" && (
            <p className="text-center text-lg text-yellow-400">
              Connection failed. Retrying...
            </p>
          )}
          <Spinner />
          {dbProgress !== 0 && (
            <p className="text-center">
              Progress: <span className="text-orange-500">{dbProgress}%</span>
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default ControllerLoadingOverlay;
