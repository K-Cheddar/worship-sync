import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Users } from "lucide-react";
import AppWorkspaceShell from "./AppWorkspaceShell";

jest.mock("../HomeToolbarMenu/HomeToolbarMenu", () => () => <button>Menu</button>);
jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => null);

const renderShell = (collapseMobileHeader = true) => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  render(<MemoryRouter><AppWorkspaceShell title="Teams and Services" icon={Users} collapseMobileHeader={collapseMobileHeader}>
    <div role="region" aria-label="Page scroll"><input aria-label="Editor" /></div>
  </AppWorkspaceShell></MemoryRouter>);
  const scroller = screen.getByRole("region", { name: "Page scroll" });
  Object.defineProperties(scroller, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 } });
  return { scroller };
};

it("collapses on the actual page scrollport and reveals on upward scroll", () => {
  const { scroller } = renderShell();
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  expect(screen.getByRole("banner")).toHaveClass("max-lg:grid-rows-[0fr]");
  fireEvent.scroll(scroller, { target: { scrollTop: 60 } });
  expect(screen.getByRole("banner")).not.toHaveClass("max-lg:grid-rows-[0fr]");
});

it("preserves the header while editing or displaying an overlay", () => {
  const { scroller } = renderShell();
  const editor = screen.getByRole("textbox");
  editor.focus();
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  expect(screen.getByRole("banner")).not.toHaveClass("max-lg:grid-rows-[0fr]");
  editor.blur();
  render(<div role="dialog" aria-label="Page dialog" />);
  fireEvent.scroll(scroller, { target: { scrollTop: 200 } });
  expect(screen.getByRole("banner")).not.toHaveClass("max-lg:grid-rows-[0fr]");
});

it("leaves other workspace headers fixed", () => {
  const { scroller } = renderShell(false);
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  expect(screen.getByRole("banner")).toHaveClass("contents");
});
