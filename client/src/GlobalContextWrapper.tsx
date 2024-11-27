import { Outlet } from "react-router-dom";
import GlobalInfoProvider from "./context/globalInfo";

const GlobalContextWrapper = () => {
  return (
    <GlobalInfoProvider>
      <Outlet />
    </GlobalInfoProvider>
  );
};

export default GlobalContextWrapper;
