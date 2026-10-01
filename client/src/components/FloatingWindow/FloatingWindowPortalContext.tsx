import { createContext, useContext } from "react";

type OverlayPortalContextValue = HTMLElement | null;

const OverlayPortalContext = createContext<OverlayPortalContextValue>(null);

export const OverlayPortalProvider = ({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: React.ReactNode;
}) => (
  <OverlayPortalContext.Provider value={container}>
    {children}
  </OverlayPortalContext.Provider>
);

/** Returns the nearest owner-aware overlay host, or null for normal app UI. */
export const useOverlayPortalContainer = () => useContext(OverlayPortalContext);

