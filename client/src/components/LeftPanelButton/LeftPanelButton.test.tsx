import type { FunctionComponent, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import LeftPanelButton from "./LeftPanelButton";

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

describe("LeftPanelButton", () => {
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
    expect(screen.getByRole("img", { name: "Welcome Slides" })).toHaveAttribute(
      "src",
      "https://example.com/slide.jpg",
    );
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
