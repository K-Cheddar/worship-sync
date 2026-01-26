import { useState, useEffect, useCallback } from "react";
import type { Display, WindowStatesInfo, WindowType } from "../types/electron";

export const useElectronWindows = () => {
  const [isElectron, setIsElectron] = useState(false);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [windowStates, setWindowStates] = useState<WindowStatesInfo | null>(null);

  useEffect(() => {
    const checkElectron = async () => {
      if (window.electronAPI) {
        const electronResult = await window.electronAPI.isElectron();
        setIsElectron(electronResult);
      }
    };
    checkElectron();
  }, []);

  const refreshDisplays = useCallback(async () => {
    if (window.electronAPI) {
      const displaysList = await window.electronAPI.getDisplays();
      setDisplays(displaysList);
    }
  }, []);

  const refreshWindowStates = useCallback(async () => {
    if (window.electronAPI) {
      const states = await window.electronAPI.getWindowStates();
      setWindowStates(states);
    }
  }, []);

  useEffect(() => {
    if (isElectron) {
      refreshDisplays();
      refreshWindowStates();
    }
  }, [isElectron, refreshDisplays, refreshWindowStates]);

  // Listen for window state changes from Electron
  useEffect(() => {
    if (!window.electronAPI?.onWindowStateChanged) return;

    const unsubscribe = window.electronAPI.onWindowStateChanged(() => {
      refreshWindowStates();
    });

    return () => {
      unsubscribe();
    };
  }, [refreshWindowStates]);

  // Generic window management functions
  const openWindow = useCallback(
    async (windowType: WindowType) => {
      if (window.electronAPI) {
        const result = await window.electronAPI.openWindow(windowType);
        await refreshWindowStates();
        return result;
      }
      return false;
    },
    [refreshWindowStates]
  );

  const closeWindow = useCallback(
    async (windowType: WindowType) => {
      if (window.electronAPI) {
        const result = await window.electronAPI.closeWindow(windowType);
        await refreshWindowStates();
        return result;
      }
      return false;
    },
    [refreshWindowStates]
  );

  const focusWindow = useCallback(
    async (windowType: WindowType) => {
      if (window.electronAPI) {
        return await window.electronAPI.focusWindow(windowType);
      }
      return false;
    },
    []
  );

  const toggleWindowFullscreen = useCallback(
    async (windowType: WindowType) => {
      if (window.electronAPI) {
        const result = await window.electronAPI.toggleWindowFullscreen(windowType);
        // Wait longer for fullscreen transition and event to complete
        await new Promise(resolve => setTimeout(resolve, 400));
        await refreshWindowStates();
        return result;
      }
      return false;
    },
    [refreshWindowStates]
  );

  const moveWindowToDisplay = useCallback(
    async (windowType: WindowType, displayId: number) => {
      if (window.electronAPI) {
        const result = await window.electronAPI.moveWindowToDisplay(windowType, displayId);
        await refreshWindowStates();
        return result;
      }
      return false;
    },
    [refreshWindowStates]
  );

  const setDisplayPreference = useCallback(
    async (windowType: WindowType, displayId: number) => {
      if (window.electronAPI) {
        const result = await window.electronAPI.setDisplayPreference(windowType, displayId);
        await refreshWindowStates();
        return result;
      }
      return false;
    },
    [refreshWindowStates]
  );

  return {
    isElectron,
    displays,
    windowStates,
    refreshDisplays,
    refreshWindowStates,
    // Generic window management functions
    openWindow,
    closeWindow,
    focusWindow,
    toggleWindowFullscreen,
    moveWindowToDisplay,
    setDisplayPreference,
  };
};
