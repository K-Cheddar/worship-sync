import { useState } from "react";
import Button from "../Button/Button";
import type {
  ConnectionStatus,
  ControllerStartupInfo,
  StartupFailure,
} from "../../context/controllerInfo";

const stageLabels: Record<ControllerStartupInfo["stage"], string> = {
  idle: "Waiting to prepare the workspace",
  "preparing-local-database": "Preparing the local database",
  "preparing-local-database-and-connecting":
    "Preparing the local database and connecting to the server",
  "preparing-local-database-and-reconnecting":
    "Preparing the local database while the server reconnects",
  "connecting-to-server": "Connecting to the server",
  "preparing-database-sync": "Preparing database synchronization",
  "synchronizing-database-content": "Synchronizing database content",
  "finalizing-initialization": "Finalizing initialization",
  reconnecting: "Reconnecting to the server",
  completed: "WorshipSync is ready",
  failed: "Startup could not finish",
};

const failureTitles: Record<StartupFailure["kind"], string> = {
  "local-storage": "Couldn't open the local database",
  "server-connection": "Unable to connect to the server",
  authentication: "Couldn't verify the server session",
  "remote-database": "Couldn't prepare database synchronization",
  replication: "Couldn't finish database synchronization",
};

const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `${minutes} min`
    : `${minutes} min ${remainingSeconds} sec`;
};

export function DbStartupFailurePanel({
  failure,
  startupInfo,
  dbProgress,
  connectionStatus,
}: {
  failure: StartupFailure;
  startupInfo: ControllerStartupInfo;
  dbProgress: number | null;
  connectionStatus?: ConnectionStatus;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div role="alert" className="space-y-1 text-center">
        <p className="text-base font-semibold">{failureTitles[failure.kind]}</p>
        <p className="text-sm leading-5 text-gray-300">{failure.message}</p>
      </div>
      <Button
        onClick={() => window.location.reload()}
        variant="cta"
        padding="px-4 py-2"
      >
        Reload WorshipSync
      </Button>
      <DbStartupLoadingDetails
        startupInfo={startupInfo}
        dbProgress={dbProgress}
        connectionStatus={connectionStatus}
        failure={failure}
      />
    </div>
  );
}

export function DbStartupLoadingDetails({
  startupInfo,
  dbProgress,
  connectionStatus,
  failure,
}: {
  startupInfo: ControllerStartupInfo;
  dbProgress: number | null;
  connectionStatus?: ConnectionStatus;
  failure?: StartupFailure | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const status = connectionStatus?.status ?? "unknown";
  const retries =
    connectionStatus?.retryCount !== undefined
      ? String(connectionStatus.retryCount)
      : "—";

  return (
    <details
      className="w-full max-w-md text-left text-base"
      onToggle={(event) => {
        if (event.currentTarget.open) setNow(Date.now());
      }}
    >
      <summary
        data-testid="startup-details-summary"
        className="cursor-pointer select-none list-none text-gray-300 hover:text-white [&::-webkit-details-marker]:hidden"
      >
        <span className="underline-offset-2 hover:underline">Show details</span>
      </summary>
      <div className="mt-2 space-y-1 rounded border border-gray-600 bg-black/20 px-3 py-2 text-sm text-gray-200">
        <p data-testid="startup-details-stage">
          Stage: <span>{stageLabels[startupInfo.stage]}</span>
        </p>
        <p>
          Progress: {" "}
          {dbProgress === null ? (
            <span data-testid="startup-details-progress">Not yet measurable</span>
          ) : (
            <span className="text-orange-500" data-testid="startup-details-progress">
              {dbProgress}%
            </span>
          )}
        </p>
        <p data-testid="startup-details-connection">
          Connection: {" "}
          <span className="font-mono">
            {status} (retries: {retries})
          </span>
        </p>
        <p>Startup time: {formatDuration(now - startupInfo.startedAt)}</p>
        <p>
          Time since meaningful activity: {" "}
          {formatDuration(now - startupInfo.lastMeaningfulActivityAt)}
        </p>
        {failure?.diagnostic && (
          <p data-testid="startup-details-error">
            Details: <span className="font-mono">{failure.diagnostic}</span>
          </p>
        )}
      </div>
    </details>
  );
}

export const getStartupStageLabel = (
  stage: ControllerStartupInfo["stage"],
) => stageLabels[stage];
