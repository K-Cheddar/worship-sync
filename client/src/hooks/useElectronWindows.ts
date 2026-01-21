import { useState, useEffect, useCallback } from "react";
import type { Display, WindowStatesInfo } from "../types/electron";

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

  const openProjectorWindow = useCallback(async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.openProjectorWindow();
      await refreshWindowStates();
      return result;
    }
    return false;
  }, [refreshWindowStates]);

  const openMonitorWindow = useCallback(async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.openMonitorWindow();
      await refreshWindowStates();
      return result;
    }
    return false;
  }, [refreshWindowStates]);

  const closeProjectorWindow = useCallback(async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.closeProjectorWindow();
      await refreshWindowStates();
      return result;
    }
    return false;
  }, [refreshWindowStates]);

  const closeMonitorWindow = useCallback(async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.closeMonitorWindow();
      await refreshWindowStates();
      return result;
    }
    return false;
  }, [refreshWindowStates]);

  const toggleProjectorFullscreen = useCallback(async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.toggleProjectorFullscreen();
      // Wait longer for fullscreen transition and event to complete
      await new Promise(resolve => setTimeout(resolve, 400));
      await refreshWindowStates();
      return result;
    }
    return false;
  }, [refreshWindowStates]);

  const toggleMonitorFullscreen = useCallback(async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.toggleMonitorFullscreen();
      // Wait longer for fullscreen transition and event to complete
      await new Promise(resolve => setTimeout(resolve, 400));
      await refreshWindowStates();
      return result;
    }
    return false;
  }, [refreshWindowStates]);

  const moveProjectorToDisplay = useCallback(
    async (displayId: number) => {
      if (window.electronAPI) {
        const result = await window.electronAPI.moveProjectorToDisplay(displayId);
        await refreshWindowStates();
        return result;
      }
      return false;
    },
    [refreshWindowStates]
  );

  const moveMonitorToDisplay = useCallback(
    async (displayId: number) => {
      if (window.electronAPI) {
        const result = await window.electronAPI.moveMonitorToDisplay(displayId);
        await refreshWindowStates();
        return result;
      }
      return false;
    },
    [refreshWindowStates]
  );

  const focusProjectorWindow = useCallback(async () => {
    if (window.electronAPI) {
      return await window.electronAPI.focusProjectorWindow();
    }
    return false;
  }, []);

  const focusMonitorWindow = useCallback(async () => {
    if (window.electronAPI) {
      return await window.electronAPI.focusMonitorWindow();
    }
    return false;
  }, []);

  return {
    isElectron,
    displays,
    windowStates,
    refreshDisplays,
    refreshWindowStates,
    openProjectorWindow,
    openMonitorWindow,
    closeProjectorWindow,
    closeMonitorWindow,
    toggleProjectorFullscreen,
    toggleMonitorFullscreen,
    moveProjectorToDisplay,
    moveMonitorToDisplay,
    focusProjectorWindow,
    focusMonitorWindow,
  };
};
