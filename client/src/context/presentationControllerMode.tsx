import { createContext, useContext, useState, type ReactNode } from "react";

export type PresentationControllerMode = "present" | "edit";

const STORAGE_KEY = "worshipsync_presentation_controller_mode";
type ModeContext = { mode: PresentationControllerMode; setMode: (mode: PresentationControllerMode) => void };
const Context = createContext<ModeContext | undefined>(undefined);

const readMode = (): PresentationControllerMode => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "edit" ? "edit" : "present";
  } catch {
    return "present";
  }
};

export const PresentationControllerModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<PresentationControllerMode>(readMode);
  const setMode = (nextMode: PresentationControllerMode) => {
    setModeState(nextMode);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextMode);
    } catch {
      // Keep the in-memory preference usable when storage is unavailable.
    }
  };
  return <Context.Provider value={{ mode, setMode }}>{children}</Context.Provider>;
};

export const usePresentationControllerMode = (): ModeContext =>
  useContext(Context) ?? { mode: "edit", setMode: () => undefined };
