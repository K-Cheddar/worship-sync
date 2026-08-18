import { Outlet } from "react-router-dom";
import ControllerInfoProvider from "./context/controllerInfo";
import LocalImageUploadManager from "./components/LocalImageUploadManager/LocalImageUploadManager";
import LocalMediaCloudShareManager from "./components/LocalMediaCloudShareManager/LocalMediaCloudShareManager";
import LocalVideoIssueManager from "./components/LocalVideoIssueManager/LocalVideoIssueManager";
import LocalVideoCaptureManager from "./components/LocalVideoCaptureManager/LocalVideoCaptureManager";

const ControllerContextWrapper = () => {
  return (
    <ControllerInfoProvider>
      <LocalImageUploadManager />
      <LocalMediaCloudShareManager />
      {!window.__ELECTRON__ && <LocalVideoCaptureManager />}
      <LocalVideoIssueManager />
      <Outlet />
    </ControllerInfoProvider>
  );
};

export default ControllerContextWrapper;
