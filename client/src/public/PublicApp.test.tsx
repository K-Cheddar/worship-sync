import { render, screen } from "@testing-library/react";
import PublicApp from "./PublicApp";

jest.mock("../components/HomeToolbarMenu/HomeToolbarMenu", () => () => (
  <button type="button" aria-label="Open menu">
    Menu
  </button>
));

describe("PublicApp SMS opt-in route", () => {
  it("renders the demo tenant through the public app shell", async () => {
    window.history.pushState({}, "", "/sms-opt-in/demo");

    render(<PublicApp />);

    expect(
      await screen.findByRole("heading", { name: "Optional SMS updates" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No thanks — continue without SMS" })).toBeInTheDocument();
  });
});
