import {
  __resetInterfaceZoomForTests,
  applyInterfaceZoomToDocument,
  getInterfaceZoomSnapshot,
  INTERFACE_ZOOM_MAX,
  INTERFACE_ZOOM_MIN,
  INTERFACE_ZOOM_STORAGE_KEY,
  resetInterfaceZoom,
  setInterfaceZoom,
  subscribeInterfaceZoom,
} from "./interfaceZoom";

describe("interfaceZoom", () => {
  beforeEach(() => {
    __resetInterfaceZoomForTests();
    document.documentElement.style.fontSize = "";
  });

  it("clamps and steps zoom values", () => {
    setInterfaceZoom(57);
    expect(getInterfaceZoomSnapshot()).toBe(60);

    setInterfaceZoom(INTERFACE_ZOOM_MIN - 20);
    expect(getInterfaceZoomSnapshot()).toBe(INTERFACE_ZOOM_MIN);

    setInterfaceZoom(INTERFACE_ZOOM_MAX + 50);
    expect(getInterfaceZoomSnapshot()).toBe(INTERFACE_ZOOM_MAX);
  });

  it("persists to localStorage and applies root font-size", () => {
    setInterfaceZoom(120);
    expect(localStorage.getItem(INTERFACE_ZOOM_STORAGE_KEY)).toBe("120");
    expect(document.documentElement.style.fontSize).toBe("120%");
  });

  it("notifies subscribers and reset restores 100%", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeInterfaceZoom(listener);

    setInterfaceZoom(150);
    expect(listener).toHaveBeenCalledTimes(1);

    resetInterfaceZoom();
    expect(getInterfaceZoomSnapshot()).toBe(100);
    expect(document.documentElement.style.fontSize).toBe("100%");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setInterfaceZoom(110);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("applyInterfaceZoomToDocument uses current snapshot by default", () => {
    setInterfaceZoom(80);
    document.documentElement.style.fontSize = "";
    applyInterfaceZoomToDocument();
    expect(document.documentElement.style.fontSize).toBe("80%");
  });
});
