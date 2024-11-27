import { Outlet } from "react-router-dom";
import ControllerInfoProvider from "./context/controllerInfo";

const ControllerContextWrapper = () => {
  return (
    <ControllerInfoProvider>
      <Outlet />
    </ControllerInfoProvider>
  );
};

export default ControllerContextWrapper;
