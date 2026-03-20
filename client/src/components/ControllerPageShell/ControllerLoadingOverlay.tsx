import Button from "../Button/Button";
import Spinner from "../Spinner/Spinner";
import { ConnectionStatus } from "../../context/controllerInfo";

type ControllerLoadingOverlayProps = {
  dbProgress?: number;
  connectionStatus?: ConnectionStatus;
  user?: string;
};

const ControllerLoadingOverlay = ({
  dbProgress = 0,
  connectionStatus,
  user,
}: ControllerLoadingOverlayProps) => {
  if (dbProgress === 100) return null;

  return (
    <div className="fixed top-0 left-0 z-50 bg-gray-800/85 w-full h-full flex justify-center items-center flex-col text-white text-2xl gap-8">
      {connectionStatus?.status === "failed" ? (
        <>
          <p className="text-center">Unable to connect to the server</p>
          <p className="text-lg text-gray-300 text-center max-w-md">
            Oh no! We encountered an unexpected error. Please try again later.
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
          <p>
            Setting up <span className="font-bold">Worship</span>
            <span className="text-orange-500 font-semibold">Sync</span> for{" "}
            <span className="font-semibold">{user}</span>
          </p>
          {connectionStatus?.status === "retrying" && (
            <p className="text-lg text-yellow-400">
              Connection failed. Retrying...
            </p>
          )}
          <Spinner />
          {dbProgress !== 0 && (
            <p>
              Progress: <span className="text-orange-500">{dbProgress}%</span>
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default ControllerLoadingOverlay;
