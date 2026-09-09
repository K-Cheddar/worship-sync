import type { FunctionComponent, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import LeftPanelButton from "./LeftPanelButton";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";

jest.mock("../Button/Button", () => ({
  __esModule: true,
  default: ({
    children,
    to,
    svg,
    iconSize,
  }: {
    children?: ReactNode;
    to?: string;
    svg?: FunctionComponent;
    iconSize?: string;
  }) => (
    <div
      data-testid="left-panel-link"
      data-to={to}
      data-has-svg={svg ? "true" : "false"}
      data-icon-size={iconSize}
    >
      {children}
    </div>
  ),
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => url,
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

describe("LeftPanelButton", () => {
  beforeEach(() => {
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

  it("uses the absolute route callers provide without prefixing /controller", () => {
    render(
      <LeftPanelButton
        isSelected={false}
        to="/aux-controller/abc/item/test/list-1"
        title="Welcome"
        type="song"
        id="list-1"
      />,
    );

    expect(screen.getByTestId("left-panel-link")).toHaveAttribute(
      "data-to",
      "/aux-controller/abc/item/test/list-1",
    );
  });

  it("shows a small type icon alongside the slide thumbnail", () => {
    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/test/list-1"
        title="Welcome Slides"
        type="free"
        id="list-1"
        image="https://example.com/slide.jpg"
      />,
    );

    const link = screen.getByTestId("left-panel-link");
    expect(link).toHaveAttribute("data-has-svg", "true");
    expect(link).toHaveAttribute("data-icon-size", "xs");
    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "https://example.com/slide.jpg",
    );
  });

  it("hides unresolved local-image backgrounds instead of showing alt text", () => {
    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/test/list-1"
        title="Welcome Slides"
        type="free"
        id="list-1"
        image="local-image://missing-asset"
      />,
    );

    expect(screen.queryByAltText("")).not.toBeInTheDocument();
    expect(screen.getByText("Welcome Slides")).toBeInTheDocument();
  });

  it("hides unresolved local-video-file backgrounds to avoid CSP violations", () => {
    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/test/list-1"
        title="Local clip"
        type="free"
        id="list-1"
        image="local-video-file://video-1"
      />,
    );

    expect(screen.queryByAltText("")).not.toBeInTheDocument();
  });

  it("resolves localVideoFile thumbnails when metadata is present", () => {
    mockUseLocalVideoFileUrl.mockReturnValue({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "blob:local-video-thumb",
    });

    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/test/list-1"
        title="Local clip"
        type="free"
        id="list-1"
        image="local-video-file://video-1"
        localVideoFile={{
          id: "video-1",
          ownerDeviceId: "device-1",
          ownerLabel: "This PC",
          fileName: "clip.mp4",
          contentType: "video/mp4",
          storagePolicy: "local-only",
        }}
      />,
    );

    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "blob:local-video-thumb",
    );
  });

  it("resolves localImage thumbnails when metadata is present", () => {
    mockUseLocalImageUrl.mockReturnValue({
      isLocalImage: true,
      isOwner: true,
      status: "ready",
      url: "blob:local-thumb",
    });

    render(
      <LeftPanelButton
        isSelected={false}
        to="/controller/item/test/list-1"
        title="Welcome Slides"
        type="free"
        id="list-1"
        image="local-image://asset-1"
        localImage={{
          id: "asset-1",
          ownerDeviceId: "device-1",
          ownerLabel: "This PC",
          fileName: "slide.png",
          contentType: "image/png",
          storagePolicy: "local-only",
        }}
      />,
    );

    expect(screen.getByAltText("")).toHaveAttribute("src", "blob:local-thumb");
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

    const link = screen.getByTestId("left-panel-link");
    expect(link).toHaveAttribute("data-has-svg", "true");
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
});
