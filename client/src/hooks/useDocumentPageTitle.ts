import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getPageTitle } from "../utils/pageTitles";

/** Keeps `document.title` in sync with the current router pathname. */
export const useDocumentPageTitle = (): void => {
  const location = useLocation();

  useEffect(() => {
    document.title = getPageTitle(location.pathname);
  }, [location.pathname]);
};
