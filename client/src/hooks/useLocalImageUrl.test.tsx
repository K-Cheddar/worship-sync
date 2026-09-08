import { renderHook, waitFor } from "@testing-library/react";
import { useLocalImageUrl } from "./useLocalImageUrl";
import type { LocalImageAssetReference } from "../types";
import { getOrCreateDeviceId } from "../utils/authStorage";
import {
  acquireLocalImageThumbnailUrl,
  acquireLocalImageUrl,
  peekLocalImageThumbnailUrl,
  peekLocalImageUrl,
} from "../utils/localImageUrlCache";

jest.mock("../utils/authStorage", () => ({
  getOrCreateDeviceId: jest.fn(() => "device-1"),
}));

jest.mock("../utils/localImageAssets", () => ({
  ...jest.requireActual("../utils/localImageAssets"),
  subscribeLocalImageChanges: jest.fn(() => jest.fn()),
}));

jest.mock("../utils/localImageUrlCache", () => ({
  acquireLocalImageThumbnailUrl: jest.fn(),
  acquireLocalImageUrl: jest.fn(),
  peekLocalImageThumbnailUrl: jest.fn(),
  peekLocalImageUrl: jest.fn(),
}));

const mockGetOrCreateDeviceId = jest.mocked(getOrCreateDeviceId);
const mockAcquireLocalImageUrl = jest.mocked(acquireLocalImageUrl);
const mockAcquireLocalImageThumbnailUrl = jest.mocked(
  acquireLocalImageThumbnailUrl,
);
const mockPeekLocalImageUrl = jest.mocked(peekLocalImageUrl);
const mockPeekLocalImageThumbnailUrl = jest.mocked(peekLocalImageThumbnailUrl);
const mockReleaseLocalImageUrl = jest.fn();
const reference: LocalImageAssetReference = {
  id: "asset-1",
  contentRevision: "revision-1",
  ownerDeviceId: "device-1",
  ownerLabel: "Booth PC",
  fileName: "Welcome.png",
  contentType: "image/png",
  storagePolicy: "local-only",
};

describe("useLocalImageUrl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrCreateDeviceId.mockReturnValue("device-1");
    mockPeekLocalImageUrl.mockReturnValue(undefined);
    mockPeekLocalImageThumbnailUrl.mockReturnValue(undefined);
    mockAcquireLocalImageUrl.mockReturnValue({
      url: Promise.resolve(undefined),
      release: mockReleaseLocalImageUrl,
    });
    mockAcquireLocalImageThumbnailUrl.mockReturnValue({
      url: Promise.resolve(undefined),
      release: mockReleaseLocalImageUrl,
    });
  });

  it("returns a warm owner URL on the first render", () => {
    mockPeekLocalImageUrl.mockReturnValue("blob:warm-local-image");
    mockAcquireLocalImageUrl.mockReturnValue({
      url: new Promise(() => undefined),
      release: mockReleaseLocalImageUrl,
    });

    const { result } = renderHook(() => useLocalImageUrl(reference));

    expect(result.current).toEqual({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:warm-local-image",
    });
  });

  it("loads the durable blob on the owning device", async () => {
    mockAcquireLocalImageUrl.mockReturnValue({
      url: Promise.resolve("blob:local-image"),
      release: mockReleaseLocalImageUrl,
    });

    const { result, unmount } = renderHook(() => useLocalImageUrl(reference));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.url).toBe("blob:local-image");
    expect(mockAcquireLocalImageUrl).toHaveBeenCalledWith(
      "asset-1",
      "revision-1",
    );

    unmount();
    expect(mockReleaseLocalImageUrl).toHaveBeenCalled();
  });

  it("keeps the owner URL ready when a cloud copy is attached", async () => {
    mockAcquireLocalImageUrl.mockReturnValue({
      url: Promise.resolve("blob:local-image"),
      release: mockReleaseLocalImageUrl,
    });
    const { result, rerender } = renderHook(
      ({ value }) => useLocalImageUrl(value),
      { initialProps: { value: reference } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    mockAcquireLocalImageUrl.mockReturnValue({
      url: new Promise(() => undefined),
      release: mockReleaseLocalImageUrl,
    });

    rerender({
      value: {
        ...reference,
        storagePolicy: "local-and-cloud",
        cloudMediaId: "media-1",
        cloudUrl: "https://res.cloudinary.com/example/welcome.png",
      },
    });

    expect(result.current).toEqual({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:local-image",
    });
  });

  it("reports local-only images as unavailable on another device", () => {
    mockGetOrCreateDeviceId.mockReturnValue("device-2");

    const { result } = renderHook(() => useLocalImageUrl(reference));

    expect(result.current).toEqual({
      isLocalImage: true,
      isOwner: false,
      status: "unavailable",
      url: undefined,
    });
    expect(mockAcquireLocalImageUrl).not.toHaveBeenCalled();
  });

  it("uses the cloud fallback on another device", () => {
    mockGetOrCreateDeviceId.mockReturnValue("device-2");

    const { result } = renderHook(() =>
      useLocalImageUrl({
        ...reference,
        storagePolicy: "local-and-cloud",
        cloudUrl: "https://res.cloudinary.com/example/welcome.png",
      }),
    );

    expect(result.current.status).toBe("ready");
    expect(result.current.url).toBe(
      "https://res.cloudinary.com/example/welcome.png",
    );
  });

  it("loads only the bounded thumbnail for an outline consumer", async () => {
    mockAcquireLocalImageThumbnailUrl.mockReturnValue({
      url: Promise.resolve("blob:local-thumbnail"),
      release: mockReleaseLocalImageUrl,
    });

    const { result } = renderHook(() =>
      useLocalImageUrl(reference, "thumbnail"),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.url).toBe("blob:local-thumbnail");
    expect(mockAcquireLocalImageThumbnailUrl).toHaveBeenCalledWith(
      "asset-1",
      "revision-1",
    );
    expect(mockAcquireLocalImageUrl).not.toHaveBeenCalled();
  });

  it("never returns the previous asset URL after the reference changes", async () => {
    mockAcquireLocalImageUrl.mockImplementation((assetId) => ({
      url: Promise.resolve(`blob:${assetId}`),
      release: mockReleaseLocalImageUrl,
    }));
    const secondReference = { ...reference, id: "asset-2" };
    const { result, rerender } = renderHook(
      ({ value }) => useLocalImageUrl(value),
      { initialProps: { value: reference } },
    );
    await waitFor(() => expect(result.current.url).toBe("blob:asset-1"));

    rerender({ value: secondReference });

    expect(result.current.status).toBe("loading");
    expect(result.current.url).toBeUndefined();
    await waitFor(() => expect(result.current.url).toBe("blob:asset-2"));
  });

  it("reacquires the same asset when its byte revision changes", async () => {
    mockAcquireLocalImageUrl
      .mockReturnValueOnce({
        url: Promise.resolve("blob:revision-1"),
        release: mockReleaseLocalImageUrl,
      })
      .mockReturnValueOnce({
        url: Promise.resolve("blob:revision-2"),
        release: mockReleaseLocalImageUrl,
      });
    const { result, rerender } = renderHook(
      ({ value }) => useLocalImageUrl(value),
      { initialProps: { value: reference } },
    );
    await waitFor(() => expect(result.current.url).toBe("blob:revision-1"));

    rerender({
      value: { ...reference, contentRevision: "revision-2" },
    });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.url).toBe("blob:revision-2"));
    expect(mockAcquireLocalImageUrl).toHaveBeenCalledTimes(2);
    expect(mockAcquireLocalImageUrl).toHaveBeenLastCalledWith(
      "asset-1",
      "revision-2",
    );
  });
});
