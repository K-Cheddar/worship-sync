import React, { createContext } from "react";

export type ConnectionStatus = {
  status: "connecting" | "retrying" | "failed" | "connected";
  retryCount: number;
};

export const ControllerInfoContext = createContext<unknown>(null);

export let globalDb: unknown = undefined;
export let globalBibleDb: unknown = undefined;
export let globalBroadcastRef: unknown = undefined;

export const updateGlobalBroadcast = jest.fn();

const ControllerInfoProvider = ({ children }: { children: React.ReactNode }) => (
  <ControllerInfoContext.Provider value={null}>
    {children}
  </ControllerInfoContext.Provider>
);

export default ControllerInfoProvider;
