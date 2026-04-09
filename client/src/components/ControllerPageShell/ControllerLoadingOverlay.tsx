import Button from "../Button/Button";
import Spinner from "../Spinner/Spinner";
import { ConnectionStatus } from "../../context/controllerInfo";

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
  if (dbProgress === 100) return null;

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
    <div className="fixed top-0 left-0 z-50 bg-gray-800/85 w-full h-full flex justify-center items-center flex-col text-white text-2xl gap-8">
      {connectionStatus?.status === "failed" ? (
        <>
          <p className="text-center">Unable to connect to the server</p>
          <p className="text-lg text-gray-300 text-center max-w-md">
            Check your network connection, then reload or try again.
          </p>
          <Button
            onClick={() => window.location.reload()}
            variant="cta"
            padding="px-4 py-2"
          >
            Try Again
          </Button>
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
