import { useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { GlobalInfoContext } from "../context/globalInfo";

const RequireLogin = () => {
  const { loginState } = useContext(GlobalInfoContext) || {};
  const location = useLocation();

  if (loginState === "idle" || loginState === "loading") {
    return null;
  }

  if (loginState !== "success") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};

export default RequireLogin;
