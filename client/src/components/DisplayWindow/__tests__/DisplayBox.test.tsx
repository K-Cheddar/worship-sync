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
let currentLocalVideoDisplayResolution = notLocalVideoFileResolution;
let currentLocalVideoThumbnailResolution = notLocalVideoFileResolution;
const mockUseLocalVideoFileUrl = jest.fn(
  (value: unknown, purpose?: unknown): LocalVideoFileResolution =>
    value
      ? purpose === "thumbnail"
        ? currentLocalVideoThumbnailResolution
        : currentLocalVideoDisplayResolution
      : notLocalVideoFileResolution,
);
const setLocalVideoFileResolution = (value: LocalVideoFileResolution) => {
  currentLocalVideoDisplayResolution = value;
  currentLocalVideoThumbnailResolution = value;
  mockUseLocalVideoFileUrl.mockImplementation((reference: unknown, purpose?: unknown) =>
    reference
      ? purpose === "thumbnail"
        ? currentLocalVideoThumbnailResolution
        : currentLocalVideoDisplayResolution
      : notLocalVideoFileResolution,
  );
};
const setLocalVideoFileResolutions = (
  display: LocalVideoFileResolution,
  thumbnail: LocalVideoFileResolution,
) => {
  currentLocalVideoDisplayResolution = display;
  currentLocalVideoThumbnailResolution = thumbnail;
  mockUseLocalVideoFileUrl.mockImplementation((reference: unknown, purpose?: unknown) =>
    reference
      ? purpose === "thumbnail"
        ? currentLocalVideoThumbnailResolution
        : currentLocalVideoDisplayResolution
      : notLocalVideoFileResolution,
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
  useResolvedCachedMediaUrl: (url?: string) => url,
}));

jest.mock("../../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: (value: unknown) => mockUseLocalImageUrl(value),
}));

jest.mock("../../../hooks/useLocalVideoFileUrl", () => ({
  useLocalVideoFileUrl: (value: unknown, purpose?: unknown) =>
    mockUseLocalVideoFileUrl(value, purpose),
  isUnavailableLocalVideoFile: (resolution: LocalVideoFileResolution) =>
    resolution.isLocalVideoFile && resolution.status === "unavailable",
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

  it("keeps a remote-owned image quiet unless an operator preview opts in", () => {
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: false,
      status: "unavailable",
      url: undefined,
    });
    const { rerender } = render(
      <DisplayBox box={localImageBox} width={100} showBackground index={0} />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(
      <DisplayBox
        box={localImageBox}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
        statusScaleFactor={0.25}
      />,
    );
    expect(screen.getByText("Local source on another device")).toHaveStyle({
      fontSize: "152px",
    });
    expect(screen.getByText("Local image · Welcome.png")).toBeInTheDocument();
    expect(screen.getByText("Available on Booth PC")).toBeInTheDocument();
  });

  it("keeps a usable remote image fallback ahead of an unavailable local warning", () => {
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: false,
      status: "unavailable",
    });
    const fallbackBox = {
      ...localImageBox,
      background: "https://cdn.example.test/welcome.png",
    };

    render(
      <DisplayBox
        box={fallbackBox}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
      />,
    );

    expect(screen.getByAltText("Main")).toHaveAttribute(
      "src",
      "https://cdn.example.test/welcome.png",
    );
    expect(screen.queryByText("Local source on another device")).not.toBeInTheDocument();
  });

  it("keeps loading distinct and respects a display that hides the background", () => {
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: true,
      status: "loading",
    });
    const { rerender } = render(
      <DisplayBox
        box={localImageBox}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
      />,
    );
    expect(screen.getByText("Loading local image")).toBeInTheDocument();
    expect(screen.queryByText("Local image unavailable")).not.toBeInTheDocument();

    setLocalImageResolution({
      isLocalImage: true,
      isOwner: false,
      status: "unavailable",
    });
    rerender(
      <DisplayBox
        box={localImageBox}
        width={100}
        showBackground={false}
        index={0}
        showLocalSourceStatus
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows unavailable local video files only in an opted-in preview", () => {
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: false,
      status: "unavailable",
    });
    const { rerender } = render(
      <DisplayBox box={localVideoBox} width={100} showBackground index={0} />,
    );
    expect(screen.queryByText("Local source on another device")).not.toBeInTheDocument();

    rerender(
      <DisplayBox
        box={localVideoBox}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
      />,
    );
    expect(screen.getByText("Local video · Welcome.mp4")).toBeInTheDocument();
    expect(
      screen.getByText("Local video unavailable on this device"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Source is local to another device"),
    ).toBeInTheDocument();
    expect(screen.getByText("Available on Booth PC")).toBeInTheDocument();
  });

  it("clears an unavailable local video still and releases output paint readiness", () => {
    const onPaintReadyChange = jest.fn();
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: false,
      status: "unavailable",
    });

    render(
      <DisplayBox
        box={{
          ...localVideoBox,
          mediaInfo: {
            ...localVideoBox.mediaInfo!,
            placeholderImage: "https://cdn.example.com/video-still.jpg",
          },
        }}
        width={100}
        showBackground
        index={0}
        onPaintReadyChange={onPaintReadyChange}
      />,
    );

    expect(
      screen.getByTestId("unavailable-local-video-black-screen"),
    ).toBeInTheDocument();
    expect(screen.queryByAltText("Main")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onPaintReadyChange).toHaveBeenLastCalledWith(true);
  });

  it("keeps the saved still in compact slide thumbnails", () => {
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: false,
      status: "unavailable",
    });

    render(
      <DisplayBox
        box={{
          ...localVideoBox,
          mediaInfo: {
            ...localVideoBox.mediaInfo!,
            placeholderImage: "https://cdn.example.com/video-still.jpg",
          },
        }}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
        localSourceStatusSize="thumbnail"
      />,
    );

    expect(screen.getByAltText("Main")).toHaveAttribute(
      "src",
      "https://cdn.example.com/video-still.jpg",
    );
  });

  it("keeps an unavailable video's saved still off live output and on its compact slide thumbnail", () => {
    const savedStill = "https://cdn.example.com/video-still.jpg";
    setLocalVideoFileResolutions(
      {
        isLocalVideoFile: true,
        isOwner: false,
        status: "unavailable",
      },
      {
        isLocalVideoFile: true,
        isOwner: false,
        status: "ready",
        url: savedStill,
      },
    );
    const box = {
      ...localVideoBox,
      mediaInfo: { ...localVideoBox.mediaInfo!, placeholderImage: savedStill },
    };
    const { rerender } = render(
      <DisplayBox box={box} width={100} showBackground index={0} />,
    );

    const liveBlackFallback = screen.getByTestId("unavailable-local-video-black-screen");
    expect(liveBlackFallback).toBeVisible();
    expect(liveBlackFallback).toHaveClass("bg-black");
    expect(screen.queryByTestId("display-box-local-video-thumbnail")).not.toBeInTheDocument();

    rerender(
      <DisplayBox
        box={box}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
        localSourceStatusSize="thumbnail"
      />,
    );

    expect(screen.getByTestId("display-box-local-video-thumbnail")).toHaveAttribute(
      "src",
      savedStill,
    );
  });

  it("does not mark a loading or cloud-backed local video as unavailable", () => {
    const onPaintReadyChange = jest.fn();
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: true,
      status: "loading",
    });
    const { rerender } = render(
      <DisplayBox
        box={localVideoBox}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
        onPaintReadyChange={onPaintReadyChange}
      />,
    );
    expect(screen.getByText("Loading local video")).toBeInTheDocument();
    expect(screen.queryByText("Local video unavailable")).not.toBeInTheDocument();
    expect(onPaintReadyChange).toHaveBeenLastCalledWith(false);

    setLocalVideoFileResolution({
      isLocalVideoFile: false,
      isOwner: false,
      status: "ready",
      url: "https://cdn.example/video.mp4",
    });
    rerender(
      <DisplayBox
        box={localVideoBox}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
      />,
    );
    expect(screen.queryByText("Local source on another device")).not.toBeInTheDocument();
  });

  it("does not mark a playable video unavailable when only its local thumbnail is missing", () => {
    mockUseLocalVideoFileUrl.mockImplementation((_reference, purpose) =>
      purpose === "thumbnail"
        ? { isLocalVideoFile: true, isOwner: false, status: "unavailable" }
        : {
            isLocalVideoFile: false,
            isOwner: false,
            status: "ready",
            url: "https://cdn.example/video.mp4",
          },
    );
    render(
      <DisplayBox
        box={localVideoBox}
        width={100}
        showBackground
        index={0}
        showLocalSourceStatus
      />,
    );
    expect(screen.queryByText("Local source on another device")).not.toBeInTheDocument();
  });

  it("keeps unavailable local images terminal and paint-ready", () => {
    const onPaintReadyChange = jest.fn();
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: false,
      status: "unavailable",
    });
    render(
      <DisplayBox
        box={localImageBox}
        width={100}
        showBackground
        index={0}
        onPaintReadyChange={onPaintReadyChange}
      />,
    );
    expect(onPaintReadyChange).toHaveBeenLastCalledWith(true);
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
    expect(
      mockTimeline.fromTo.mock.calls.filter(
        ([selector]) => selector === ".display-box-background",
      ),
    ).toHaveLength(0);

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
      mockTimeline.fromTo.mock.calls.filter(
        ([selector]) => selector === ".display-box-background",
      ),
    ).toHaveLength(1);
    expect(
      screen.getByTestId("display-box-background-fallback"),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(
      screen.getByTestId("display-box-background-fallback"),
    ).toHaveClass("opacity-0");
    expect(incomingImage).not.toHaveStyle({ opacity: "0" });
  });

  it("reports paint readiness only after the selected image has loaded", () => {
    const onPaintReadyChange = jest.fn();
    setLocalImageResolution({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:incoming-local-image",
    });

    render(
      <DisplayBox
        box={localImageBox}
        width={100}
        showBackground
        index={0}
        onPaintReadyChange={onPaintReadyChange}
      />,
    );

    expect(onPaintReadyChange).toHaveBeenLastCalledWith(false);
    fireEvent.load(screen.getByAltText("Main"));
    expect(onPaintReadyChange).toHaveBeenLastCalledWith(true);
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

  it("clears the outgoing matching background so text can crossfade above the incoming image", () => {
    render(
      <DisplayBox
        box={baseBox}
        prevBox={{ ...baseBox, words: "Next lyric" }}
        width={100}
        showBackground
        index={0}
        shouldAnimate
        isPrev
      />,
    );

    expect(mockTimeline.fromTo).toHaveBeenCalledWith(
      ".display-box-background",
      { opacity: 0 },
      expect.objectContaining({ opacity: 0, duration: 0 }),
      "fadeOut",
    );
    expect(mockTimeline.fromTo).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      expect.objectContaining({ opacity: 0, duration: 0.35 }),
      "fadeOut",
    );
  });

  it("holds the incoming matching background while text still fades in", () => {
    render(
      <DisplayBox
        box={{ ...baseBox, words: "Next lyric" }}
        prevBox={baseBox}
        width={100}
        showBackground
        index={0}
        shouldAnimate
      />,
    );

    expect(screen.getByAltText("Main")).toHaveStyle({ opacity: "1" });
    expect(mockTimeline.set).toHaveBeenCalledWith(
      ".display-box-background",
      { opacity: 1 },
      "fadeIn",
    );
    expect(mockTimeline.fromTo).not.toHaveBeenCalledWith(
      ".display-box-background",
      expect.anything(),
      expect.anything(),
      "fadeIn",
    );
    expect(mockTimeline.fromTo).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 0 },
      expect.objectContaining({ opacity: 1, duration: 0.35 }),
      "fadeIn",
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

  it("still fades changed text out after a parent re-render mid-transition", () => {
    const outgoing = baseBox;
    const incoming = { ...baseBox, words: "Next lyric", background: "next.jpg" };
    const { rerender } = render(
      <DisplayBox
        box={outgoing}
        prevBox={incoming}
        width={100}
        showBackground
        index={0}
        shouldAnimate
        isPrev
      />,
    );

    expect(mockTimeline.fromTo).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      expect.objectContaining({ opacity: 0, duration: 0.35 }),
      "fadeOut",
    );

    mockTimeline.set.mockClear();
    mockTimeline.fromTo.mockClear();

    // Parent re-render with a new box identity but the same changed peer words
    // must keep fading out — not flip to keepVisible.
    rerender(
      <DisplayBox
        box={{ ...outgoing }}
        prevBox={incoming}
        width={100}
        showBackground
        index={0}
        shouldAnimate
        isPrev
      />,
    );

    expect(mockTimeline.fromTo).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      expect.objectContaining({ opacity: 0, duration: 0.35 }),
      "fadeOut",
    );
    expect(mockTimeline.set).not.toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      "fadeOut",
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

  it("lifts the still while the lane file video is paint-ready", () => {
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
        isPrev
        activeVideoUrl="worshipsync-media://asset/video-1?v=rev-1"
        isWindowVideoLoaded
      />,
    );

    expect(screen.getByAltText("Main")).toHaveClass("opacity-0");
  });

  it("keeps the still hidden until the lane file video is paint-ready", () => {
    setLocalVideoFileResolution({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "worshipsync-media://asset/video-2?v=rev-1",
    });

    render(
      <DisplayBox
        box={{
          ...localVideoBox,
          mediaInfo: {
            ...localVideoBox.mediaInfo!,
            localVideoFile: {
              ...localVideoBox.mediaInfo!.localVideoFile!,
              id: "video-2",
            },
            background: "local-video-file://video-2",
          },
        }}
        width={100}
        showBackground
        index={0}
        activeVideoUrl="worshipsync-media://asset/video-2?v=rev-1"
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

  it("does not reuse a managed image after the background identity changes", () => {
    const { rerender } = render(
      <DisplayBox
        box={{ ...baseBox, background: "blue.jpg" }}
        width={100}
        showBackground
        index={0}
        isTransitionManaged
      />,
    );

    expect(screen.getByAltText("Main")).toHaveAttribute("src", "blue.jpg");

    rerender(
      <DisplayBox
        box={{ ...baseBox, words: "Song B", background: "red.jpg" }}
        width={100}
        showBackground
        index={0}
        isTransitionManaged
      />,
    );

    expect(screen.getByAltText("Main")).toHaveAttribute("src", "red.jpg");
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

