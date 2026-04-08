import { ReactNode, useContext } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";

type ViewAccessBlockedRedirectProps = {
  children: ReactNode;
};

/**
 * Redirects view-only sessions away from display outputs, info controller,
 * and board moderation/display routes.
 */
const ViewAccessBlockedRedirect = ({
  children,
}: ViewAccessBlockedRedirectProps) => {
  const { access, sessionKind } = useContext(GlobalInfoContext) || {};
  const location = useLocation();

  if (sessionKind !== "display" && access === "view") {
    return <Navigate to="/home" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};

export default ViewAccessBlockedRedirect;
