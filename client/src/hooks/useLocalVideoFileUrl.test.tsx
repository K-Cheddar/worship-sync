import { renderHook, waitFor } from "@testing-library/react";
import { useLocalVideoFileUrl } from "./useLocalVideoFileUrl";
import type { LocalVideoFileReference } from "../types";
import { getOrCreateDeviceId } from "../utils/authStorage";
import {
  acquireLocalVideoFileThumbnailUrl,
  acquireLocalVideoFileUrl,
  peekLocalVideoFileThumbnailUrl,
  peekLocalVideoFileUrl,
} from "../utils/localVideoFileUrlCache";

jest.mock("../utils/authStorage", () => ({
  getOrCreateDeviceId: jest.fn(() => "device-1"),
}));

jest.mock("../utils/localVideoFileAssets", () => ({
  ...jest.requireActual("../utils/localVideoFileAssets"),
  subscribeLocalVideoFileChanges: jest.fn(() => jest.fn()),
}));

jest.mock("../utils/localVideoFileUrlCache", () => ({
  acquireLocalVideoFileThumbnailUrl: jest.fn(),
  acquireLocalVideoFileUrl: jest.fn(),
  peekLocalVideoFileThumbnailUrl: jest.fn(),
  peekLocalVideoFileUrl: jest.fn(),
}));

const mockGetOrCreateDeviceId = jest.mocked(getOrCreateDeviceId);
const mockAcquireLocalVideoFileUrl = jest.mocked(acquireLocalVideoFileUrl);
const mockAcquireLocalVideoFileThumbnailUrl = jest.mocked(
  acquireLocalVideoFileThumbnailUrl,
);
const mockPeekLocalVideoFileUrl = jest.mocked(peekLocalVideoFileUrl);
const mockPeekLocalVideoFileThumbnailUrl = jest.mocked(
  peekLocalVideoFileThumbnailUrl,
);
const mockRelease = jest.fn();
const reference: LocalVideoFileReference = {
  id: "video-1",
  contentRevision: "revision-1",
  ownerDeviceId: "device-1",
  ownerLabel: "Booth PC",
  fileName: "welcome.mp4",
  contentType: "video/mp4",
  storagePolicy: "local-only",
};

describe("useLocalVideoFileUrl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrCreateDeviceId.mockReturnValue("device-1");
    mockPeekLocalVideoFileUrl.mockReturnValue(undefined);
    mockPeekLocalVideoFileThumbnailUrl.mockReturnValue(undefined);
    mockAcquireLocalVideoFileUrl.mockReturnValue({
      url: Promise.resolve(undefined),
      release: mockRelease,
    });
    mockAcquireLocalVideoFileThumbnailUrl.mockReturnValue({
      url: Promise.resolve(undefined),
      release: mockRelease,
    });
  });

  it("loads only the bounded thumbnail for a list consumer", async () => {
    mockAcquireLocalVideoFileThumbnailUrl.mockReturnValue({
      url: Promise.resolve("blob:local-video-thumb"),
      release: mockRelease,
    });

    const { result } = renderHook(() =>
      useLocalVideoFileUrl(reference, "thumbnail"),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.url).toBe("blob:local-video-thumb");
    expect(mockAcquireLocalVideoFileThumbnailUrl).toHaveBeenCalledWith(
      "video-1",
      "revision-1",
    );
    expect(mockAcquireLocalVideoFileUrl).not.toHaveBeenCalled();
  });

  it("does not use a remote video URL as a thumbnail on another device", () => {
    mockGetOrCreateDeviceId.mockReturnValue("device-2");

    const { result } = renderHook(() =>
      useLocalVideoFileUrl(
        {
          ...reference,
          cloudUrl: "https://example.com/welcome.mp4",
        },
        "thumbnail",
      ),
    );

    expect(result.current).toEqual({
      isLocalVideoFile: true,
      isOwner: false,
      status: "unavailable",
    });
    expect(mockAcquireLocalVideoFileThumbnailUrl).not.toHaveBeenCalled();
  });
});
