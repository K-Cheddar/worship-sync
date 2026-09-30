import { fireEvent, render, screen } from "@testing-library/react";
import BootstrapRecoveryScreen from "./BootstrapRecoveryScreen";

describe("BootstrapRecoveryScreen", () => {
  it("shows recovery guidance and lets the user reload", () => {
    const onReload = jest.fn();
    render(<BootstrapRecoveryScreen onReload={onReload} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "WorshipSync couldn’t finish loading.",
    );
    expect(screen.getByText("Check your connection and try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
