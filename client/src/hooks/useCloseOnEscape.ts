import { useEffect } from "react";

/**
 * Custom hook to close an Electron window when ESC key is pressed
 * @param closeFunction - Function to call when ESC is pressed (should close the window)
 */
export const useCloseOnEscape = (closeFunction: () => Promise<void>) => {
  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.electronAPI) {
        await closeFunction();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeFunction]);
};
