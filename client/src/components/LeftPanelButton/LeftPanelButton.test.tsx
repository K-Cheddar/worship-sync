import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import LeftPanelButton from "./LeftPanelButton";

jest.mock("../Button/Button", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: () => undefined,
}));

describe("LeftPanelButton", () => {
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
});
