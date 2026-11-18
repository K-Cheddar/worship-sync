import { Outlet, useLocation } from "react-router-dom";
import ControllerInfoProvider from "./context/controllerInfo";
import LocalImageUploadManager from "./components/LocalImageUploadManager/LocalImageUploadManager";
import LocalMediaCloudShareManager from "./components/LocalMediaCloudShareManager/LocalMediaCloudShareManager";
import LocalVideoIssueManager from "./components/LocalVideoIssueManager/LocalVideoIssueManager";
import LocalVideoCaptureManager from "./components/LocalVideoCaptureManager/LocalVideoCaptureManager";
import LocalVideoListWarmPublisher from "./components/LocalVideoListWarmPublisher/LocalVideoListWarmPublisher";
import { TransferProvider } from "./context/transferContext";
import DesktopVideoDownloadManager from "./components/DesktopVideoDownloadManager/DesktopVideoDownloadManager";

const needsLocalVideoListWarming = (pathname: string) =>
  pathname === "/controller" ||
  pathname.startsWith("/controller/") ||
  pathname.startsWith("/aux-controller/");

const ControllerContextWrapper = () => {
  const { pathname } = useLocation();

  return (
    <ControllerInfoProvider>
      <TransferProvider>
        <DesktopVideoDownloadManager>
          <LocalImageUploadManager />
          <LocalMediaCloudShareManager />
          {needsLocalVideoListWarming(pathname) ? (
            <LocalVideoListWarmPublisher />
          ) : null}
          {!window.__ELECTRON__ && <LocalVideoCaptureManager />}
          <LocalVideoIssueManager />
          <Outlet />
        </DesktopVideoDownloadManager>
      </TransferProvider>
    </ControllerInfoProvider>
  );
};

export default ControllerContextWrapper;
