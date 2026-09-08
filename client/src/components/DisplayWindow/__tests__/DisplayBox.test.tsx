import { act, fireEvent, render, screen } from "@testing-library/react";
import gsap from "gsap";
import DisplayBox from "../DisplayBox";
import type { Box } from "../../../types";
import type { LocalImageResolution } from "../../../hooks/useLocalImageUrl";
import type { LocalVideoFileResolution } from "../../../hooks/useLocalVideoFileUrl";

const mockTimeline = {
  clear: jest.fn(),
  addLabel: jest.fn(),
  set: jest.fn(),
  fromTo: jest.fn(),
  to: jest.fn(),
};
const notLocalImageResolution: LocalImageResolution = {
  isLocalImage: false,
  isOwner: false,
  status: "not-local",
  url: undefined,
};
let currentLocalImageResolution = notLocalImageResolution;
const mockUseLocalImageUrl = jest.fn(
  (value: unknown): LocalImageResolution =>
    value ? currentLocalImageResolution : notLocalImageResolution,
);
const setLocalImageResolution = (value: LocalImageResolution) => {
  currentLocalImageResolution = value;
  mockUseLocalImageUrl.mockImplementation((reference: unknown) =>
    reference ? currentLocalImageResolution : notLocalImageResolution,
  );
};
const notLocalVideoFileResolution: LocalVideoFileResolution = {
  isLocalVideoFile: false,
  isOwner: false,
  status: "not-local",
  url: undefined,
};
let currentLocalVideoFileResolution = notLocalVideoFileResolution;
const mockUseLocalVideoFileUrl = jest.fn(
  (value: unknown, _purpose?: unknown): LocalVideoFileResolution =>
    value ? currentLocalVideoFileResolution : notLocalVideoFileResolution,
);
const setLocalVideoFileResolution = (value: LocalVideoFileResolution) => {
  currentLocalVideoFileResolution = value;
  mockUseLocalVideoFileUrl.mockImplementation((reference: unknown) =>
    reference ? currentLocalVideoFileResolution : notLocalVideoFileResolution,
  );
};
const mockUseGSAPDependencies = jest.fn();

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    timeline: jest.fn(),
  },
}));

jest.mock("@gsap/react", () => ({
  useGSAP: (callback: () => void, config?: { dependencies?: unknown[] }) => {
    const React = jest.requireActual("react");
    const previousDependencies = React.useRef(
      undefined as unknown[] | undefined,
    );
    React.useLayoutEffect(() => {
      const dependencies = config?.dependencies ?? [];
      mockUseGSAPDependencies(dependencies);
      const haveDependenciesChanged =
        !previousDependencies.current ||
        previousDependencies.current.length !== dependencies.length ||
        dependencies.some(
          (dependency, dependencyIndex) =>
            !Object.is(
              dependency,
              previousDependencies.current?.[dependencyIndex],
            ),
        );
      if (!haveDependenciesChanged) return;
      previousDependencies.current = dependencies;
      callback();
    });
  },
}));

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => url,
}));

jest.mock("../../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: (value: unknown) => mockUseLocalImageUrl(value),
}));

jest.mock("../../../hooks/useLocalVideoFileUrl", () => ({
  useLocalVideoFileUrl: (value: unknown, purpose?: unknown) =>
    mockUseLocalVideoFileUrl(value, purpose),
}));

jest.mock("../TimerDisplay", () => ({
  __esModule: true,
  default: () => <span data-testid="timer-display-mock" />,
}));

jest.mock("../NowDisplay", () => ({
  __esModule: true,
  default: () => <span data-testid="now-display-mock" />,
}));

const baseBox: Box = {
  id: "box-1",
  words: "Same lyric",
  width: 100,
  height: 100,
  fontSize: 40,
  brightness: 100,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "current.jpg",
  fontColor: "#fff",
  shouldKeepAspectRatio: false,
  transparent: false,
  excludeFromOverflow: false,
  align: "center",
  slideIndex: 0,
  label: "Main",
  isBold: false,
  isItalic: false,
};

const localImageBox: Box = {
  ...baseBox,
  background: "local-image://asset-1",
  mediaInfo: {
    path: "",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    format: "png",
    height: 1080,
    width: 1920,
    name: "Welcome.png",
    publicId: "asset-1",
    type: "image",
    id: "asset-1",
    background: "local-image://asset-1",
    thumbnail: "local-image://asset-1",
    source: "local",
    localImage: {
      id: "asset-1",
      contentRevision: "revision-1",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      fileName: "Welcome.png",
      contentType: "image/png",
      storagePolicy: "local-only",
    },
  },
};

const localVideoBox: Box = {
  ...baseBox,
  background: "local-video-file://video-1",
  mediaInfo: {
    path: "",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    format: "mp4",
    height: 1080,
    width: 1920,
    name: "Welcome.mp4",
    publicId: "video-1",
    type: "video",
    id: "video-1",
    background: "local-video-file://video-1",
    thumbnail: "",
    placeholderImage: "",
    source: "local",
    localVideoFile: {
      id: "video-1",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      fileName: "Welcome.mp4",
      contentType: "video/mp4",
      storagePolicy: "local-only",
    },
  },
};

describe("DisplayBox", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(gsap.timeline).mockReturnValue(mockTimeline as any);
    setLocalImageResolution(notLocalImageResolution);
    setLocalVideoFileResolution(notLocalVideoFileResolution);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows an unavailable status for a local-only image on another device", () => {
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: false,
      status: "unavailable",
      url: undefined,
    });
    render(
      <DisplayBox box={localImageBox} width={100} showBackground index={0} />,
    );

    expect(screen.getByText("Local image unavailable")).toBeInTheDocument();
    expect(screen.getByText("Available on Booth PC only.")).toBeInTheDocument();
  });

  it("renders a warm owner image without loading chrome", () => {
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:warm-local-image",
    });

    render(
      <DisplayBox box={localImageBox} width={100} showBackground index={0} />,
    );

    expect(screen.getByAltText("Main")).toHaveAttribute(
      "src",
      "blob:warm-local-image",
    );
    expect(screen.queryByText("Loading local image")).not.toBeInTheDocument();
  });

  it("recognizes an already-complete local image without waiting for onLoad", () => {
    const completeDescriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "complete",
    );
    const naturalWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "naturalWidth",
    );
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 1920,
    });
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:already-decoded",
    });

    try {
      render(
        <DisplayBox
          box={localImageBox}
          width={100}
          showBackground
          index={0}
          shouldAnimate
        />,
      );

      expect(mockTimeline.fromTo).toHaveBeenCalledWith(
        ".display-box-background",
        { opacity: 0 },
        expect.objectContaining({ opacity: 1 }),
        "fadeIn",
      );
    } finally {
      if (completeDescriptor) {
        Object.defineProperty(
          HTMLImageElement.prototype,
          "complete",
          completeDescriptor,
        );
      }
      if (naturalWidthDescriptor) {
        Object.defineProperty(
          HTMLImageElement.prototype,
          "naturalWidth",
          naturalWidthDescriptor,
        );
      }
    }
  });

  it("holds the previous frame and only animates the background after a cold local image loads", () => {
    jest.useFakeTimers();
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: true,
      status: "loading",
      url: undefined,
    });
    const { rerender } = render(
      <DisplayBox
        box={localImageBox}
        width={100}
        showBackground
        index={0}
        shouldAnimate
        prevBox={{ ...baseBox, background: "previous.jpg" }}
      />,
    );
    expect(screen.queryByText("Loading local image")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("display-box-background-fallback"),
    ).toHaveAttribute("src", "previous.jpg");
    const textAnimationCallsBeforeReady = mockTimeline.fromTo.mock.calls.filter(
      ([selector]) => selector === ".display-box-text",
    ).length;

    setLocalImageResolution({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:cold-local-image",
    });
    rerender(
      <DisplayBox
        box={localImageBox}
        width={100}
        showBackground
        index={0}
        shouldAnimate
        prevBox={{ ...baseBox, background: "previous.jpg" }}
      />,
    );

    const incomingImage = screen.getByAltText("Main");
    expect(incomingImage).toHaveAttribute("src", "blob:cold-local-image");
    expect(
      screen.getByTestId("display-box-background-fallback"),
    ).toBeInTheDocument();

    fireEvent.load(incomingImage);

    expect(
      mockTimeline.fromTo.mock.calls.filter(
        ([selector]) => selector === ".display-box-text",
      ),
    ).toHaveLength(textAnimationCallsBeforeReady);
    expect(mockTimeline.fromTo).toHaveBeenCalledWith(
      ".display-box-background",
      { opacity: 0 },
      expect.objectContaining({ opacity: 1, duration: 0.5 }),
      "fadeIn",
    );
    expect(
      screen.getByTestId("display-box-background-fallback"),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(
      screen.queryByTestId("display-box-background-fallback"),
    ).not.toBeInTheDocument();
  });

  it("keeps matching text visible while the background crossfades out", () => {
    render(
      <DisplayBox
        box={baseBox}
        prevBox={{ ...baseBox, background: "next.jpg" }}
        width={100}
        showBackground
        index={0}
        shouldAnimate
        isPrev
      />,
    );

    expect(mockTimeline.set).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      "fadeOut",
    );
    expect(mockTimeline.fromTo).not.toHaveBeenCalledWith(
      ".display-box-text",
      expect.anything(),
      expect.objectContaining({ opacity: 0 }),
      "fadeOut",
    );
  });

  it("crossfades relinked local bytes even when the persisted background URI matches", () => {
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:revision-2",
    });
    render(
      <DisplayBox
        box={{
          ...localImageBox,
          mediaInfo: {
            ...localImageBox.mediaInfo!,
            localImage: {
              ...localImageBox.mediaInfo!.localImage!,
              contentRevision: "revision-2",
            },
          },
        }}
        prevBox={localImageBox}
        width={100}
        showBackground
        index={0}
        shouldAnimate
      />,
    );

    fireEvent.load(screen.getByAltText("Main"));

    expect(mockTimeline.fromTo).toHaveBeenCalledWith(
      ".display-box-background",
      { opacity: 0 },
      expect.objectContaining({ opacity: 1, duration: 0.5 }),
      "fadeIn",
    );
  });

  it("keeps matching text visible while the background crossfades in", () => {
    render(
      <DisplayBox
        box={baseBox}
        prevBox={{ ...baseBox, background: "previous.jpg" }}
        width={100}
        showBackground
        index={0}
        shouldAnimate
      />,
    );

    expect(mockTimeline.set).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      "fadeIn",
    );
    expect(mockTimeline.fromTo).not.toHaveBeenCalledWith(
      ".display-box-text",
      expect.objectContaining({ opacity: 0 }),
      expect.anything(),
      "fadeIn",
    );
  });

  it("does not skip the text fade when matching words use dynamic timer placeholders", () => {
    render(
      <DisplayBox
        box={{ ...baseBox, words: "{{timer}}" }}
        prevBox={{ ...baseBox, words: "{{timer}}", background: "previous.jpg" }}
        width={100}
        showBackground
        index={0}
        shouldAnimate
        isPrev
      />,
    );

    expect(mockTimeline.set).not.toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      "fadeOut",
    );
    expect(mockTimeline.fromTo).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      expect.objectContaining({ opacity: 0, duration: 0.35 }),
      "fadeOut",
    );
  });

  it("renders a local video still as the slide background", () => {
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "blob:local-video-still",
    });

    render(
      <DisplayBox box={localVideoBox} width={100} showBackground index={0} />,
    );

    expect(screen.getByAltText("Main")).toHaveAttribute(
      "src",
      "blob:local-video-still",
    );
    expect(mockUseLocalVideoFileUrl).toHaveBeenCalledWith(
      localVideoBox.mediaInfo?.localVideoFile,
      "thumbnail",
    );
  });

  it("prefers the local video still over a cloud placeholder", () => {
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "blob:local-video-still",
    });

    render(
      <DisplayBox
        box={{
          ...localVideoBox,
          mediaInfo: {
            ...localVideoBox.mediaInfo!,
            placeholderImage: "https://cdn.example/still.jpg",
          },
        }}
        width={100}
        showBackground
        index={0}
      />,
    );

    expect(screen.getByAltText("Main")).toHaveAttribute(
      "src",
      "blob:local-video-still",
    );
  });

  /**
   * The box stores `local-video-file://` while the player is handed the
   * resolved `worshipsync-media://` URL. Comparing the raw form left the still
   * painted at full opacity over a video that was playing underneath, which
   * looked exactly like a frozen output on the projector and monitor.
   */
  it("lifts the still once a local video file is playing under it", () => {
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "worshipsync-media://asset/video-1?v=rev-1",
    });

    render(
      <DisplayBox
        box={localVideoBox}
        width={100}
        showBackground
        index={0}
        activeVideoUrl="worshipsync-media://asset/video-1?v=rev-1"
        isWindowVideoLoaded
      />,
    );

    expect(screen.getByAltText("Main")).toHaveClass("opacity-0");
  });

  it("keeps the still up while a different video is the active source", () => {
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "worshipsync-media://asset/video-1?v=rev-1",
    });

    render(
      <DisplayBox
        box={localVideoBox}
        width={100}
        showBackground
        index={0}
        activeVideoUrl="worshipsync-media://asset/other-video?v=rev-1"
        isWindowVideoLoaded
      />,
    );

    expect(screen.getByAltText("Main")).toHaveClass("opacity-100");
  });

  it("keeps a cloud video still when no local thumbnail is available", () => {
    render(
      <DisplayBox
        box={{
          ...baseBox,
          background: "https://cdn.example/video.mp4",
          mediaInfo: {
            path: "",
            createdAt: "2026-08-17T00:00:00.000Z",
            updatedAt: "2026-08-17T00:00:00.000Z",
            format: "mp4",
            height: 1080,
            width: 1920,
            name: "Welcome.mp4",
            publicId: "cloud-video-1",
            type: "video",
            id: "cloud-video-1",
            background: "https://cdn.example/video.mp4",
            thumbnail: "",
            placeholderImage: "https://cdn.example/still.jpg",
          },
        }}
        width={100}
        showBackground
        index={0}
      />,
    );

    expect(screen.getByAltText("Main")).toHaveAttribute(
      "src",
      "https://cdn.example/still.jpg",
    );
  });

  it("renders incoming background and text hidden before the fade-in starts", () => {
    render(
      <DisplayBox
        box={baseBox}
        width={100}
        showBackground
        index={0}
        shouldAnimate
      />,
    );

    expect(screen.getByAltText("Main")).toHaveStyle({ opacity: "0" });
    expect(screen.getByText("Same lyric")).toHaveStyle({ opacity: "0" });
  });
});

