import { createContext, useContext, type ReactNode } from "react";
import { useTeamsPageState } from "./hooks/useTeamsPageState";

export type TeamsPageState = ReturnType<typeof useTeamsPageState>;

const TeamsPageContext = createContext<TeamsPageState | null>(null);

export const TeamsPageProvider = ({ children }: { children: ReactNode }) => {
  const value = useTeamsPageState();

  return (
    <TeamsPageContext.Provider value={value}>
      {children}
    </TeamsPageContext.Provider>
  );
};

export const useTeamsPage = () => {
  const context = useContext(TeamsPageContext);
  if (!context) {
    throw new Error("useTeamsPage must be used within TeamsPageProvider.");
  }
  return context;
};
