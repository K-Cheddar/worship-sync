import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThumbnailPreviewMode = "projector" | "monitor" | "stream";

type ThumbnailPreviewModeContextValue = {
  previewMode: ThumbnailPreviewMode;
  setPreviewMode: (mode: ThumbnailPreviewMode) => void;
};

const DEFAULT_CONTEXT_VALUE: ThumbnailPreviewModeContextValue = {
  previewMode: "projector",
  setPreviewMode: () => undefined,
};

const ThumbnailPreviewModeContext =
  createContext<ThumbnailPreviewModeContextValue>(DEFAULT_CONTEXT_VALUE);

export const ThumbnailPreviewModeProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [previewMode, setPreviewModeState] =
    useState<ThumbnailPreviewMode>("projector");
  const setPreviewMode = useCallback(
    (mode: ThumbnailPreviewMode) => setPreviewModeState(mode),
    [],
  );
  const value = useMemo(
    () => ({ previewMode, setPreviewMode }),
    [previewMode, setPreviewMode],
  );

  return (
    <ThumbnailPreviewModeContext.Provider value={value}>
      {children}
    </ThumbnailPreviewModeContext.Provider>
  );
};

export const useThumbnailPreviewMode = () =>
  useContext(ThumbnailPreviewModeContext);
