import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PublicApp from "./PublicApp";

jest.mock("../components/HomeToolbarMenu/HomeToolbarMenu", () => () => (
  <button type="button" aria-label="Open menu">
    Menu
  </button>
));

describe("PublicApp SMS opt-in route", () => {
  it("renders the demo tenant through the public app shell", async () => {
    window.history.pushState({}, "", "/sms-opt-in/demo");

    render(<PublicApp onLeaveToOperatorApp={jest.fn()} />);

    expect(
      await screen.findByRole("heading", { name: "Optional SMS updates" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No thanks — continue without SMS" })).toBeInTheDocument();
  });

  it("hands the continuation link off to the unauthenticated app root", async () => {
    const user = userEvent.setup();
    const onLeaveToOperatorApp = jest.fn();
    window.history.pushState({}, "", "/sms-opt-in/demo");

    render(<PublicApp onLeaveToOperatorApp={onLeaveToOperatorApp} />);
    await user.click(await screen.findByRole("button", { name: "No thanks — continue without SMS" }));
    await user.click(screen.getByRole("link", { name: "Continue to WorshipSync" }));

    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(onLeaveToOperatorApp).toHaveBeenCalledWith("/");
  });
});
