import { act, renderHook, waitFor } from "@testing-library/react";
import { useElectronWindows } from "./useElectronWindows";

describe("useElectronWindows", () => {
  const displays = [
    {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
      rotation: 0,
      internal: true,
      label: "Main",
    },
  ];

  const windowStates = {
    projector: { displayId: 1, width: 1280, height: 720, isFullScreen: true },
    monitor: { displayId: 2, width: 1280, height: 720, isFullScreen: false },
    projectorOpen: true,
    monitorOpen: false,
  };

  let windowStateChangedCallback: (() => void) | null = null;
  let unsubscribeMock: jest.Mock;

  beforeEach(() => {
    unsubscribeMock = jest.fn();
    windowStateChangedCallback = null;
    (window as any).electronAPI = {
      isElectron: jest.fn().mockResolvedValue(true),
      getDisplays: jest.fn().mockResolvedValue(displays),
      getWindowStates: jest.fn().mockResolvedValue(windowStates),
      onWindowStateChanged: jest.fn((callback: () => void) => {
        windowStateChangedCallback = callback;
        return unsubscribeMock;
      }),
      openWindow: jest.fn().mockResolvedValue(true),
      closeWindow: jest.fn().mockResolvedValue(true),
      focusWindow: jest.fn().mockResolvedValue(true),
      toggleWindowFullscreen: jest.fn().mockResolvedValue(true),
      moveWindowToDisplay: jest.fn().mockResolvedValue(true),
      setDisplayPreference: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it("loads the default projector and monitor window state in Electron", async () => {
    const { result, unmount } = renderHook(() => useElectronWindows());

    await waitFor(() => expect(result.current.isElectron).toBe(true));
    await waitFor(() => expect(result.current.displays).toEqual(displays));
    await waitFor(() =>
      expect(result.current.windowStates).toEqual(windowStates)
    );

    expect(window.electronAPI?.getDisplays).toHaveBeenCalledTimes(1);
    expect(window.electronAPI?.getWindowStates).toHaveBeenCalledTimes(1);
    expect(window.electronAPI?.onWindowStateChanged).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes window state after default projector and monitor actions", async () => {
    const { result } = renderHook(() => useElectronWindows());

    await waitFor(() => expect(result.current.isElectron).toBe(true));

    const initialRefreshCalls = (window.electronAPI?.getWindowStates as jest.Mock)
      .mock.calls.length;

    await act(async () => {
      await result.current.openWindow("projector");
    });
    expect(window.electronAPI?.openWindow).toHaveBeenCalledWith("projector");

    await act(async () => {
      await result.current.moveWindowToDisplay("monitor", 2);
    });
    expect(window.electronAPI?.moveWindowToDisplay).toHaveBeenCalledWith(
      "monitor",
      2
    );

    await act(async () => {
      await result.current.focusWindow("monitor");
    });
    expect(window.electronAPI?.focusWindow).toHaveBeenCalledWith("monitor");

    act(() => {
      windowStateChangedCallback?.();
    });

    await waitFor(() =>
      expect(window.electronAPI?.getWindowStates).toHaveBeenCalledTimes(
        initialRefreshCalls + 3
      )
    );
  });
});
