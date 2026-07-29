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

/**
 * Keep a single Context identity across Vite Fast Refresh. Without this,
 * HMR recreates createContext() while an old Provider is still mounted, so
 * useAccountPage() reads null and throws in AccountShell.
 */
const getAccountPageContext = (): Context<AccountPageState | null> => {
  if (import.meta.hot?.data.AccountPageContext) {
    return import.meta.hot.data.AccountPageContext as Context<
      AccountPageState | null
    >;
  }

  const context = createContext<AccountPageState | null>(null);

  if (import.meta.hot) {
    import.meta.hot.data.AccountPageContext = context;
  }

  return context;
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
