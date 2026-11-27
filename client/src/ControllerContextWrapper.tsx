import type { ReactNode } from "react";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import ControllerInfoProvider from "./context/controllerInfo";
import LocalImageUploadManager from "./components/LocalImageUploadManager/LocalImageUploadManager";
import LocalMediaCloudShareManager from "./components/LocalMediaCloudShareManager/LocalMediaCloudShareManager";
import LocalVideoIssueManager from "./components/LocalVideoIssueManager/LocalVideoIssueManager";
import LocalVideoCaptureManager from "./components/LocalVideoCaptureManager/LocalVideoCaptureManager";
import LocalVideoListWarmPublisher from "./components/LocalVideoListWarmPublisher/LocalVideoListWarmPublisher";
import { TransferProvider } from "./context/transferContext";
import DesktopVideoDownloadManager from "./components/DesktopVideoDownloadManager/DesktopVideoDownloadManager";
import {
  getStartupDiagnosticMode,
  isStartupDiagnosticsActive,
  recordStartupDiagnostic,
} from "./utils/startupDiagnostics";

const needsLocalVideoListWarming = (pathname: string) =>
  pathname === "/controller" ||
  pathname.startsWith("/controller/") ||
  pathname.startsWith("/aux-controller/");

const ControllerContextWrapper = ({ children }: { children?: ReactNode }) => {
  const { pathname } = useLocation();
  const warmsLocalVideoList = !children && needsLocalVideoListWarming(pathname);
  const skipStartupManagers = isStartupDiagnosticsActive() &&
    ["skip-databases", "replication-only"].includes(getStartupDiagnosticMode());

  useEffect(() => {
    recordStartupDiagnostic(
      "manager",
      skipStartupManagers ? "controller-route-managers.skipped" : "controller-route-managers.mounted",
      {
        localImageUploads: !skipStartupManagers,
        localMediaCloudShare: !skipStartupManagers,
        localVideoCapture: !skipStartupManagers && !window.__ELECTRON__,
        localVideoListWarming: !skipStartupManagers && warmsLocalVideoList,
        localVideoIssues: !skipStartupManagers,
        desktopVideoDownloads: !skipStartupManagers,
      },
    );
  }, [skipStartupManagers, warmsLocalVideoList]);

  if (skipStartupManagers) {
    return (
      <ControllerInfoProvider>
        {children ?? <Outlet />}
      </ControllerInfoProvider>
    );
  }

  return (
    <ControllerInfoProvider>
      <TransferProvider>
        <DesktopVideoDownloadManager>
          <LocalImageUploadManager />
          <LocalMediaCloudShareManager />
          {warmsLocalVideoList ? (
            <LocalVideoListWarmPublisher />
          ) : null}
          {!window.__ELECTRON__ && <LocalVideoCaptureManager />}
          <LocalVideoIssueManager />
          {children ?? <Outlet />}
        </DesktopVideoDownloadManager>
      </TransferProvider>
    </ControllerInfoProvider>
  );
};

export default ControllerContextWrapper;
