import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useMediaCache } from "./useMediaCache";
import { getMediaUrlsFromMediaDoc } from "../utils/mediaCacheUtils";

jest.mock("../utils/mediaCacheUtils", () => ({
  getMediaUrlsFromMediaDoc: jest.fn(),
}));

const mockGetMediaUrls = jest.mocked(getMediaUrlsFromMediaDoc);

describe("useMediaCache", () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  const renderCacheHook = () => {
    const syncMediaCache = jest.fn().mockResolvedValue({ downloaded: 0, cleaned: 0 });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { syncMediaCache },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider
        value={{ db: {} as PouchDB.Database } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
    );
    return { ...renderHook(() => useMediaCache(), { wrapper }), syncMediaCache };
  };

  it("does not destructively sync when the media document read is unavailable", async () => {
    mockGetMediaUrls.mockResolvedValue({ status: "unavailable", error: new Error("offline") });
    const { result, syncMediaCache } = renderCacheHook();

    await result.current.syncMediaCache();

    await waitFor(() => expect(mockGetMediaUrls).toHaveBeenCalled());
    expect(syncMediaCache).not.toHaveBeenCalled();
  });

  it("allows a successful empty media document to clean the cache", async () => {
    mockGetMediaUrls.mockResolvedValue({ status: "loaded", urls: new Set() });
    const { result, syncMediaCache } = renderCacheHook();

    await result.current.syncMediaCache();

    expect(syncMediaCache).toHaveBeenCalledWith([]);
  });
});
