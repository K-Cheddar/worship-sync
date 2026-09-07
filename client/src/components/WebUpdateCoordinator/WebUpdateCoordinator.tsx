import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../Button/Button";
import { isElectron } from "../../utils/environment";
import {
  getBuildTimeVersion,
  getServerVersionInfo,
  isNewerVersion,
} from "../../utils/versionUtils";
import { checkForUpdate, reloadPage } from "../../serviceWorkerRegistration";

const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

type RequiredUpdateState = "idle" | "checking" | "unavailable";

type WebUpdateCoordinatorProps = {
  /** Display routes must stay visually empty; stream output remains transparent. */
  isTransparentRoute: boolean;
};

const WebUpdateCoordinator = ({
  isTransparentRoute,
}: WebUpdateCoordinatorProps) => {
  const isWeb = !isElectron();
  const buildVersion = useMemo(getBuildTimeVersion, []);
  const [minimumVersion, setMinimumVersion] = useState<string | null>(null);
  const [requiredUpdateState, setRequiredUpdateState] =
    useState<RequiredUpdateState>("idle");
  const attemptedMinimumVersionRef = useRef<string | null>(null);

  const isUpdateRequired = Boolean(
    minimumVersion && isNewerVersion(minimumVersion, buildVersion),
  );

  const applyRequiredUpdate = useCallback(async () => {
    setRequiredUpdateState("checking");
    try {
      const result = await checkForUpdate();
      if (result === "updated") return;
      if (result === "restartRequired") {
        reloadPage();
        return;
      }
    } catch {
      // The blocking state below gives the operator a clear retry path.
    }
    setRequiredUpdateState("unavailable");
  }, []);

  useEffect(() => {
    if (!isWeb) return;

    let cancelled = false;
    const checkMinimumVersion = async () => {
      const serverVersionInfo = await getServerVersionInfo();
      if (!cancelled) {
        setMinimumVersion(serverVersionInfo?.minSupportedWebVersion ?? null);
      }
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void checkMinimumVersion();
      }
    };

    void checkMinimumVersion();
    const intervalId = window.setInterval(
      checkMinimumVersion,
      VERSION_CHECK_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [isWeb]);

  useEffect(() => {
    if (!isUpdateRequired || !minimumVersion) return;
    if (attemptedMinimumVersionRef.current === minimumVersion) return;

    attemptedMinimumVersionRef.current = minimumVersion;
    void applyRequiredUpdate();
  }, [applyRequiredUpdate, isUpdateRequired, minimumVersion]);

  if (!isWeb) return null;

  if (isUpdateRequired) {
    // A stream must never gain an opaque page background. Still attempt the
    // required update; the operator can see the blocking state on a control UI.
    if (isTransparentRoute) return null;

    return (
      <main
        className="fixed inset-0 z-[70] flex h-dvh w-full items-center justify-center bg-homepage-canvas p-4 text-white"
        role="alert"
      >
        <section className="w-full max-w-md rounded-xl border border-gray-600 bg-gray-900 p-6 text-center shadow-2xl">
          <h1 className="text-xl font-semibold">Update required</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-200">
            WorshipSync needs the latest version before you continue.
          </p>
          {requiredUpdateState === "unavailable" ? (
            <p className="mt-3 text-sm text-gray-300">
              Check your connection, then try the update again.
            </p>
          ) : null}
          <div className="mt-5">
            <Button
              className="w-full justify-center"
              onClick={() => void applyRequiredUpdate()}
              isLoading={requiredUpdateState === "checking"}
              disabled={requiredUpdateState === "checking"}
            >
              {requiredUpdateState === "checking" ? "Updating" : "Update now"}
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return null;
};

export default WebUpdateCoordinator;
