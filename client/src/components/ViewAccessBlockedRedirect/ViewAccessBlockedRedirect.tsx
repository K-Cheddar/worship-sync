import { ReactNode, useContext } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import { FULL_ACCESS_ONLY_EXACT } from "../../utils/sessionRouteAccess";

type ViewAccessBlockedRedirectProps = {
  children: ReactNode;
};

/**
 * Redirects view-only sessions away from display outputs and board
 * moderation/display routes. Also blocks non–full-access sessions
 * from board moderation (aligned with /api/boards/admin).
 */
const ViewAccessBlockedRedirect = ({
  children,
}: ViewAccessBlockedRedirectProps) => {
  const { access, sessionKind } = useContext(GlobalInfoContext) || {};
  const location = useLocation();

  if (sessionKind !== "display" && access === "view") {
    return <Navigate to="/home" replace state={{ from: location }} />;
  }

  if (
    sessionKind !== "display" &&
    access !== "full" &&
    FULL_ACCESS_ONLY_EXACT.has(location.pathname)
  ) {
    return <Navigate to="/home" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};

export default ViewAccessBlockedRedirect;
