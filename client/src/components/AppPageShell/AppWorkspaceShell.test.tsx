import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Users } from "lucide-react";
import AppWorkspaceShell from "./AppWorkspaceShell";

jest.mock("../HomeToolbarMenu/HomeToolbarMenu", () => () => <button>Menu</button>);
jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => null);

const renderShell = (collapseMobileHeader = true) => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  render(<MemoryRouter><AppWorkspaceShell title="Teams and Services" icon={Users} collapseMobileHeader={collapseMobileHeader}>
    <div role="region" aria-label="Page scroll" data-mobile-header-scroll-owner>
      <input aria-label="Editor" />
      <div role="region" aria-label="Nested scroll" />
    </div>
  </AppWorkspaceShell></MemoryRouter>);
  const scroller = screen.getByRole("region", { name: "Page scroll" });
  Object.defineProperties(scroller, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 } });
  const nestedScroller = screen.getByRole("region", { name: "Nested scroll" });
  Object.defineProperties(nestedScroller, { scrollHeight: { value: 900 }, clientHeight: { value: 300 } });
  return { scroller, nestedScroller };
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

it("ignores nested scrollers and waits for a sustained upward scroll to reveal", () => {
  const { scroller, nestedScroller } = renderShell();
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  expect(screen.getByRole("banner")).toHaveClass("max-lg:grid-rows-[0fr]");

  fireEvent.scroll(nestedScroller, { target: { scrollTop: 240 } });
  expect(screen.getByRole("banner")).toHaveClass("max-lg:grid-rows-[0fr]");

  fireEvent.scroll(scroller, { target: { scrollTop: 92 } });
  fireEvent.scroll(scroller, { target: { scrollTop: 80 } });
  expect(screen.getByRole("banner")).toHaveClass("max-lg:grid-rows-[0fr]");
  fireEvent.scroll(scroller, { target: { scrollTop: 75 } });
  expect(screen.getByRole("banner")).not.toHaveClass("max-lg:grid-rows-[0fr]");
});

it("leaves other workspace headers fixed", () => {
  const { scroller } = renderShell(false);
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  expect(screen.getByRole("banner")).toHaveClass("contents");
});
