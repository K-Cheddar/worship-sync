import { renderHook } from "@testing-library/react";
import { useCloseOnEscape } from "./useCloseOnEscape";

const fireKeydown = (key: string) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
};

describe("useCloseOnEscape", () => {
  it("calls the close function when Escape is pressed and electronAPI is present", async () => {
    const closeFunction = jest.fn().mockResolvedValue(undefined);
    (window as any).electronAPI = { isElectron: true };

    renderHook(() => useCloseOnEscape(closeFunction));
    fireKeydown("Escape");

    // Let microtasks settle
    await Promise.resolve();

    expect(closeFunction).toHaveBeenCalledTimes(1);
    delete (window as any).electronAPI;
  });

  it("does not call the close function when a non-Escape key is pressed", async () => {
    const closeFunction = jest.fn().mockResolvedValue(undefined);
    (window as any).electronAPI = { isElectron: true };

    renderHook(() => useCloseOnEscape(closeFunction));
    fireKeydown("Enter");
    fireKeydown("ArrowDown");

    await Promise.resolve();

    expect(closeFunction).not.toHaveBeenCalled();
    delete (window as any).electronAPI;
  });

  it("does not call the close function when electronAPI is absent", async () => {
    const closeFunction = jest.fn().mockResolvedValue(undefined);
    delete (window as any).electronAPI;

    renderHook(() => useCloseOnEscape(closeFunction));
    fireKeydown("Escape");

    await Promise.resolve();

    expect(closeFunction).not.toHaveBeenCalled();
  });

  it("removes the event listener on unmount", async () => {
    const closeFunction = jest.fn().mockResolvedValue(undefined);
    (window as any).electronAPI = { isElectron: true };

    const { unmount } = renderHook(() => useCloseOnEscape(closeFunction));
    unmount();
    fireKeydown("Escape");

    await Promise.resolve();

    expect(closeFunction).not.toHaveBeenCalled();
    delete (window as any).electronAPI;
  });
});
