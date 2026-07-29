import {
  createContext,
  useContext,
  type Context,
  type ReactNode,
} from "react";
import {
  useAccountPageState,
  type AccountPageState,
} from "./hooks/useAccountPageState";

const ACCOUNT_PAGE_CONTEXT_KEY = "__worshipSyncAccountPageContext__";

type AccountPageContextGlobal = {
  [ACCOUNT_PAGE_CONTEXT_KEY]?: Context<AccountPageState | null>;
};

/**
 * Keep a single Context identity across Vite Fast Refresh. Without this,
 * HMR recreates createContext() while an old Provider is still mounted, so
 * useAccountPage() reads null and throws in AccountShell.
 *
 * Uses globalThis (not import.meta.hot) so Jest can parse this module.
 */
const getAccountPageContext = (): Context<AccountPageState | null> => {
  const globalStore = globalThis as typeof globalThis &
    AccountPageContextGlobal;
  if (!globalStore[ACCOUNT_PAGE_CONTEXT_KEY]) {
    globalStore[ACCOUNT_PAGE_CONTEXT_KEY] =
      createContext<AccountPageState | null>(null);
  }
  return globalStore[ACCOUNT_PAGE_CONTEXT_KEY];
};

const AccountPageContext = getAccountPageContext();

export const AccountPageProvider = ({ children }: { children: ReactNode }) => {
  const value = useAccountPageState();

  return (
    <AccountPageContext.Provider value={value}>
      {children}
    </AccountPageContext.Provider>
  );
};

export const useAccountPage = () => {
  const context = useContext(AccountPageContext);
  if (!context) {
    throw new Error("useAccountPage must be used within AccountPageProvider.");
  }
  return context;
};
