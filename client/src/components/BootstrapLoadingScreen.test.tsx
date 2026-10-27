import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import BootstrapLoadingScreen from "./BootstrapLoadingScreen";

describe("BootstrapLoadingScreen", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps one message visible, rotates by time, and continues across remounts", () => {
    const { unmount } = render(
      <StrictMode>
        <BootstrapLoadingScreen />
      </StrictMode>,
    );

    expect(screen.getByRole("img", { name: "WorshipSync" })).toBeInTheDocument();
    expect(screen.getByText("Getting WorshipSync ready")).toBeInTheDocument();
    expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    const logoImage = screen.getByRole("img", { name: "WorshipSync" });
    const logoContainer = screen.getByTestId("loading-logo");
    expect(logoImage).toHaveClass("loading-logo__image");
    expect(logoContainer).toHaveClass("loading-logo", "h-28", "w-28");
    expect(
      logoContainer.style.getPropertyValue("--loading-logo-reveal-delay"),
    ).toBe("-0ms");
    expect(
      logoContainer.style.getPropertyValue("--loading-logo-sweep-delay"),
    ).toBe("-0ms");

    act(() => jest.advanceTimersByTime(4499));
    expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByText("Getting everything in place…")).toBeInTheDocument();

    unmount();
    expect(jest.getTimerCount()).toBe(0);

    const { unmount: unmountAfterRemount } = render(
      <StrictMode>
        <BootstrapLoadingScreen />
      </StrictMode>,
    );
    expect(screen.getByText("Getting everything in place…")).toBeInTheDocument();
    const logoContainerAfterRemount = screen.getByTestId("loading-logo");
    expect(
      logoContainerAfterRemount.style.getPropertyValue(
        "--loading-logo-reveal-delay",
      ),
    ).toBe("-1500ms");
    expect(
      logoContainerAfterRemount.style.getPropertyValue(
        "--loading-logo-sweep-delay",
      ),
    ).toBe("-1500ms");
    act(() => jest.advanceTimersByTime(4500));
    expect(screen.getByText("Making sure everything is ready…")).toBeInTheDocument();
    unmountAfterRemount();
  });
});
