import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/utils/cnHelper";

const BASE_Z = 60;
/** Above any floating window so the dock stays clickable. */
const DOCK_Z = 10000;

export type FloatingWindowEntry = {
  id: string;
  label: string;
  isMinimized: boolean;
  focus: () => void;
};

type FloatingWindowManagerValue = {
  bringToFront: () => number;
  register: (entry: FloatingWindowEntry) => () => void;
  update: (
    id: string,
    patch: Partial<Pick<FloatingWindowEntry, "label" | "isMinimized" | "focus">>,
  ) => void;
  setFrontmost: (id: string) => void;
};

const defaultManager: FloatingWindowManagerValue = {
  bringToFront: () => BASE_Z,
  register: () => () => { },
  update: () => { },
  setFrontmost: () => { },
};

const FloatingWindowManagerContext =
  createContext<FloatingWindowManagerValue>(defaultManager);

const FloatingWindowListContext = createContext<{
  windows: FloatingWindowEntry[];
  frontmostId: string | null;
}>({ windows: [], frontmostId: null });

const FloatingWindowDock = () => {
  const { windows, frontmostId } = useContext(FloatingWindowListContext);

  if (windows.length < 2) return null;

  return (
    <div
      data-testid="floating-window-dock"
      className="pointer-events-none fixed inset-x-0 bottom-12 z-[10000] flex justify-center px-2"
      style={{ zIndex: DOCK_Z }}
    >
      <div
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-lg border border-gray-600 bg-gray-900/95 p-1 shadow-lg backdrop-blur-sm"
        role="toolbar"
        aria-label="Open floating windows"
      >
        {windows.map((win) => {
          const isFront = win.id === frontmostId;
          return (
            <button
              key={win.id}
              type="button"
              onClick={win.focus}
              aria-pressed={isFront}
              title={win.label}
              className={cn(
                "max-w-[10rem] truncate rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                isFront
                  ? "bg-gray-600 text-white"
                  : "bg-gray-800 text-zinc-300 hover:bg-gray-700 hover:text-white",
                win.isMinimized && !isFront && "opacity-70",
              )}
            >
              {win.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const FloatingWindowZIndexProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const counterRef = useRef(BASE_Z);
  const [windows, setWindows] = useState<FloatingWindowEntry[]>([]);
  const [frontmostId, setFrontmostId] = useState<string | null>(null);

  const bringToFront = useCallback(() => {
    counterRef.current += 1;
    return counterRef.current;
  }, []);

  const setFrontmost = useCallback((id: string) => {
    setFrontmostId(id);
  }, []);

  const register = useCallback((entry: FloatingWindowEntry) => {
    setWindows((prev) => {
      if (prev.some((w) => w.id === entry.id)) {
        return prev.map((w) => (w.id === entry.id ? entry : w));
      }
      return [...prev, entry];
    });
    setFrontmostId(entry.id);
    return () => {
      setWindows((prev) => prev.filter((w) => w.id !== entry.id));
      setFrontmostId((current) => (current === entry.id ? null : current));
    };
  }, []);

  const update = useCallback(
    (
      id: string,
      patch: Partial<Pick<FloatingWindowEntry, "label" | "isMinimized" | "focus">>,
    ) => {
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      );
    },
    [],
  );

  const manager = useMemo(
    () => ({ bringToFront, register, update, setFrontmost }),
    [bringToFront, register, update, setFrontmost],
  );

  const listValue = useMemo(
    () => ({ windows, frontmostId }),
    [windows, frontmostId],
  );

  return (
    <FloatingWindowManagerContext.Provider value={manager}>
      <FloatingWindowListContext.Provider value={listValue}>
        {children}
        <FloatingWindowDock />
      </FloatingWindowListContext.Provider>
    </FloatingWindowManagerContext.Provider>
  );
};

/** Returns the next z-index and marks stacking order. Prefer raiseWindow for focus UX. */
export const useFloatingWindowBringToFront = () => {
  const { bringToFront } = useContext(FloatingWindowManagerContext);
  return bringToFront;
};

export const useFloatingWindowManager = () =>
  useContext(FloatingWindowManagerContext);
