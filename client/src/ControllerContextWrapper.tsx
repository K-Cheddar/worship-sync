import { Outlet } from "react-router-dom";
import ControllerInfoProvider from "./context/controllerInfo";
import LocalImageUploadManager from "./components/LocalImageUploadManager/LocalImageUploadManager";
import LocalMediaCloudShareManager from "./components/LocalMediaCloudShareManager/LocalMediaCloudShareManager";
import LocalVideoIssueManager from "./components/LocalVideoIssueManager/LocalVideoIssueManager";
import LocalVideoCaptureManager from "./components/LocalVideoCaptureManager/LocalVideoCaptureManager";
import LocalVideoListWarmPublisher from "./components/LocalVideoListWarmPublisher/LocalVideoListWarmPublisher";

const ControllerContextWrapper = () => {
  return (
    <ControllerInfoProvider>
      <LocalImageUploadManager />
      <LocalMediaCloudShareManager />
      <LocalVideoListWarmPublisher />
      {!window.__ELECTRON__ && <LocalVideoCaptureManager />}
      <LocalVideoIssueManager />
      <Outlet />
    </ControllerInfoProvider>
  );
};

export default ControllerContextWrapper;
