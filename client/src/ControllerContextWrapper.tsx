import { Outlet } from "react-router-dom";
import ControllerInfoProvider from "./context/controllerInfo";
import LocalImageUploadManager from "./components/LocalImageUploadManager/LocalImageUploadManager";
import LocalMediaCloudShareManager from "./components/LocalMediaCloudShareManager/LocalMediaCloudShareManager";
import LocalVideoIssueManager from "./components/LocalVideoIssueManager/LocalVideoIssueManager";
import LocalVideoCaptureManager from "./components/LocalVideoCaptureManager/LocalVideoCaptureManager";
import LocalVideoListWarmPublisher from "./components/LocalVideoListWarmPublisher/LocalVideoListWarmPublisher";
import { TransferProvider } from "./context/transferContext";
import DesktopVideoDownloadManager from "./components/DesktopVideoDownloadManager/DesktopVideoDownloadManager";

const ControllerContextWrapper = () => {
  return (
    <ControllerInfoProvider>
      <TransferProvider>
      <DesktopVideoDownloadManager>
      <LocalImageUploadManager />
      <LocalMediaCloudShareManager />
      <LocalVideoListWarmPublisher />
      {!window.__ELECTRON__ && <LocalVideoCaptureManager />}
      <LocalVideoIssueManager />
      <Outlet />
      </DesktopVideoDownloadManager>
      </TransferProvider>
    </ControllerInfoProvider>
  );
};

export default ControllerContextWrapper;
