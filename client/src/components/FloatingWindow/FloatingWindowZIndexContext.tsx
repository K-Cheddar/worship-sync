import { createContext, useCallback, useContext, useRef } from "react";

const BASE_Z = 60;

const FloatingWindowZIndexContext = createContext<() => number>(() => BASE_Z);

export const FloatingWindowZIndexProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const counterRef = useRef(BASE_Z);
  const bringToFront = useCallback(() => {
    counterRef.current += 1;
    return counterRef.current;
  }, []);

  return (
    <FloatingWindowZIndexContext.Provider value={bringToFront}>
      {children}
    </FloatingWindowZIndexContext.Provider>
  );
};

export const useFloatingWindowBringToFront = () =>
  useContext(FloatingWindowZIndexContext);
