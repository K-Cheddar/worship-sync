import type { FunctionComponent, ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import LeftPanelButton from "./LeftPanelButton";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";

jest.mock("../Button/Button", () => ({
  __esModule: true,
  default: ({
    children,
    svg: Svg,
    iconSize,
  }: {
    children?: ReactNode;
    svg?: FunctionComponent;
    iconSize?: string;
  }) => (
    <div data-testid="left-panel-button-content" data-icon-size={iconSize}>
      {Svg ? <Svg data-testid="item-type-icon" /> : null}
      {children}
    </div>
  ),
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: () => undefined,
}));

jest.mock("../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: jest.fn(() => ({
    isLocalImage: false,
    isOwner: false,
    status: "not-local",
  })),
}));

jest.mock("../../hooks/useLocalVideoFileUrl", () => ({
  useLocalVideoFileUrl: jest.fn(() => ({
    isLocalVideoFile: false,
    isOwner: false,
    status: "not-local",
  })),
}));

const mockUseLocalImageUrl = jest.mocked(useLocalImageUrl);
const mockUseLocalVideoFileUrl = jest.mocked(useLocalVideoFileUrl);
const originalIntersectionObserver = globalThis.IntersectionObserver;

describe("LeftPanelButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    mockUseLocalImageUrl.mockReturnValue({
      isLocalImage: false,
      isOwner: false,
      status: "not-local",
    });
    mockUseLocalVideoFileUrl.mockReturnValue({
      isLocalVideoFile: false,
      isOwner: false,
      status: "not-local",
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: originalIntersectionObserver,
    });
  });

  it("renders the supplied timer text for service-time rows", () => {
    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/test/list-1"
        title="Upcoming Service"
        type="service-time"
        id="list-1"
        isActive
        timerText="12:34"
      />,
    );

    expect(screen.getByText("12:34")).toBeInTheDocument();
  });

  it("still formats numeric timer values for timer rows", () => {
    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/test/list-2"
        title="Countdown"
        type="timer"
        id="list-2"
        isActive
        timerValue={90}
      />,
    );

    expect(
      screen.getByText((_, element) => element?.textContent === "1:30"),
    ).toBeInTheDocument();
  });

  it("always shows a smaller type icon beside a thumbnail", () => {
    const localImage = {
      id: "asset-1",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      fileName: "Welcome.png",
      contentType: "image/png",
      storagePolicy: "local-only" as const,
    };
    mockUseLocalImageUrl.mockReturnValue({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:outline-thumbnail",
    });

    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/image/item-1"
        title="Welcome"
        type="image"
        id="item-1"
        localImage={localImage}
      />,
    );

    expect(screen.getByTestId("left-panel-button-content")).toHaveAttribute(
      "data-icon-size",
      "xs",
    );
    expect(screen.getByTestId("item-type-icon")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Welcome" })).toBeInTheDocument();
  });

  it("requests the bounded local thumbnail instead of the display blob", () => {
    const localImage = {
      id: "asset-1",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      fileName: "Welcome.png",
      contentType: "image/png",
      storagePolicy: "local-only" as const,
    };
    mockUseLocalImageUrl.mockReturnValue({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:outline-thumbnail",
    });

    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/image/item-1"
        title="Welcome"
        type="image"
        id="item-1"
        localImage={localImage}
      />,
    );

    expect(mockUseLocalImageUrl).toHaveBeenCalledWith(
      localImage,
      "thumbnail",
    );
    expect(screen.getByRole("img", { name: "Welcome" })).toHaveAttribute(
      "src",
      "blob:outline-thumbnail",
    );
  });

  it("does not load an offscreen outline thumbnail", () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    const observe = jest.fn();
    const unobserve = jest.fn();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: jest.fn((callback: IntersectionObserverCallback) => {
        intersectionCallback = callback;
        return {
          observe,
          disconnect: jest.fn(),
          unobserve,
          takeRecords: jest.fn(),
        };
      }),
    });
    const localImage = {
      id: "asset-offscreen",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      fileName: "Later.png",
      contentType: "image/png",
      storagePolicy: "local-only" as const,
    };

    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/image/item-2"
        title="Later"
        type="image"
        id="item-2"
        localImage={localImage}
      />,
    );

    expect(mockUseLocalImageUrl).toHaveBeenLastCalledWith(
      undefined,
      "thumbnail",
    );
    expect(observe).toHaveBeenCalledTimes(1);
    const row = screen.getByRole("listitem");

    act(() => {
      intersectionCallback?.(
        [
          {
            isIntersecting: true,
            target: row,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });

    expect(mockUseLocalImageUrl).toHaveBeenLastCalledWith(
      localImage,
      "thumbnail",
    );
    expect(unobserve).toHaveBeenCalled();
  });

  it("requests the bounded local video still instead of the playback blob", () => {
    const localVideoFile = {
      id: "video-1",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      fileName: "Welcome.mp4",
      contentType: "video/mp4",
      storagePolicy: "local-only" as const,
    };
    mockUseLocalVideoFileUrl.mockReturnValue({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "blob:outline-video-thumb",
    });

    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/video/item-3"
        title="Welcome"
        type="video"
        id="item-3"
        localVideoFile={localVideoFile}
      />,
    );

    expect(mockUseLocalVideoFileUrl).toHaveBeenCalledWith(
      localVideoFile,
      "thumbnail",
    );
    expect(screen.getByRole("img", { name: "Welcome" })).toHaveAttribute(
      "src",
      "blob:outline-video-thumb",
    );
  });
});
