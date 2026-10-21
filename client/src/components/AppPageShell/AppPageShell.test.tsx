/* eslint-disable testing-library/no-node-access -- Compare the decorative icon SVG directly to verify its identity. */
import { render, screen } from "@testing-library/react";
import { CalendarClock } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import AppPageShell from "./AppPageShell";

jest.mock("../HomeToolbarMenu/HomeToolbarMenu", () => () => <button>Menu</button>);
jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => null);

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ undoable: { present: { preferences: { scrollbarWidth: "thin" } } } }),
}));

const renderPageShell = (iconColorClass?: string) =>
  render(
    <MemoryRouter>
      <AppPageShell
        title="My schedule"
        icon={CalendarClock}
        iconColorClass={iconColorClass}
      >
        <div>Schedule content</div>
      </AppPageShell>
    </MemoryRouter>,
  );

describe("AppPageShell icon color", () => {
  it("uses the configured icon color", () => {
    renderPageShell("text-teal-300");

    const title = screen.getByRole("heading", { name: "My schedule" });
    const titleIcon = title.querySelector("svg");
    expect(titleIcon?.parentElement).toHaveClass("text-teal-300");
    expect(title.parentElement?.parentElement?.parentElement).toHaveClass("py-3");
  });

  it("keeps its legacy orange icon color when omitted", () => {
    renderPageShell();

    const titleIcon = screen.getByRole("heading", { name: "My schedule" }).querySelector("svg");
    expect(titleIcon?.parentElement).toHaveClass("text-orange-300");
  });
});
