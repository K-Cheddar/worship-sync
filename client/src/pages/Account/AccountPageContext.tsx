import { createContext, useContext, type ReactNode } from "react";
import {
  useAccountPageState,
  type AccountPageState,
} from "./hooks/useAccountPageState";

const AccountPageContext = createContext<AccountPageState | null>(null);

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
