import { render, screen } from "@testing-library/react";
import BootstrapLoadingScreen from "./BootstrapLoadingScreen";

describe("BootstrapLoadingScreen", () => {
  it("shows the WorshipSync logo while startup is loading", () => {
    render(<BootstrapLoadingScreen />);

    expect(screen.getByRole("img", { name: "WorshipSync" })).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });
});
