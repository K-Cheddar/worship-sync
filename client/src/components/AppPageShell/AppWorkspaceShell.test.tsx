import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Users } from "lucide-react";
import AppWorkspaceShell from "./AppWorkspaceShell";

jest.mock("../HomeToolbarMenu/HomeToolbarMenu", () => () => <button>Menu</button>);
jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => null);

const renderShell = (collapseMobileHeader = true, nestedScrollOwner = false) => {
  const onAction = jest.fn();
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  render(<MemoryRouter><AppWorkspaceShell title="Teams and Services" icon={Users} collapseMobileHeader={collapseMobileHeader}>
    <div role="region" aria-label="Page scroll" data-mobile-header-scroll-owner="workspace">
      <input aria-label="Editor" />
      <button aria-label="Page action" onClick={onAction}>Action</button>
      <div
        role="region"
        aria-label="Nested scroll"
        className="overflow-y-auto"
        data-mobile-header-scroll-owner={nestedScrollOwner ? "page" : undefined}
      >
        <svg data-testid="nested-scroll-icon" aria-hidden="true"><path d="M0 0h4v4H0z" /></svg>
      </div>
    </div>
  </AppWorkspaceShell></MemoryRouter>);
  const scroller = screen.getByRole("region", { name: "Page scroll" });
  Object.defineProperties(scroller, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 } });
  const nestedScroller = screen.getByRole("region", { name: "Nested scroll" });
  Object.defineProperties(nestedScroller, { scrollHeight: { value: 900 }, clientHeight: { value: 300 } });
  return { scroller, nestedScroller, onAction };
};

it("collapses on the actual page scrollport and reveals on upward scroll", () => {
  const { scroller } = renderShell();
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  expect(screen.getByRole("banner")).toHaveClass("max-lg:grid-rows-[0fr]");
  fireEvent.scroll(scroller, { target: { scrollTop: 45 } });
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

it("lets a pointer action complete before its focus reveals the collapsed header", async () => {
  const { scroller, onAction } = renderShell();
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  const header = screen.getByRole("banner");
  const action = screen.getByRole("button", { name: "Page action" });

  fireEvent.pointerDown(action, { pointerId: 1, pointerType: "mouse", isPrimary: true });
  action.focus();
  expect(header).toHaveClass("max-lg:grid-rows-[0fr]");

  fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse", isPrimary: true });
  fireEvent.click(action);
  expect(onAction).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(header).not.toHaveClass("max-lg:grid-rows-[0fr]"));
});

it("ignores nested scrollers and waits for a sustained upward scroll to reveal", () => {
  const { scroller, nestedScroller } = renderShell();
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  expect(screen.getByRole("banner")).toHaveClass("max-lg:grid-rows-[0fr]");

  fireEvent.scroll(nestedScroller, { target: { scrollTop: 240 } });
  expect(screen.getByRole("banner")).toHaveClass("max-lg:grid-rows-[0fr]");

  fireEvent.scroll(scroller, { target: { scrollTop: 85 } });
  fireEvent.scroll(scroller, { target: { scrollTop: 68 } });
  expect(screen.getByRole("banner")).toHaveClass("max-lg:grid-rows-[0fr]");
  fireEvent.scroll(scroller, { target: { scrollTop: 52 } });
  expect(screen.getByRole("banner")).not.toHaveClass("max-lg:grid-rows-[0fr]");
});

it("tracks an explicitly designated nested page scrollport without treating other nested lists as owners", () => {
  const { scroller, nestedScroller } = renderShell(true, true);
  const header = screen.getByRole("banner");

  fireEvent.wheel(screen.getByTestId("nested-scroll-icon"), { deltaY: 100 });
  nestedScroller.scrollTop = 100;
  fireEvent.scroll(nestedScroller);
  expect(header).toHaveClass("max-lg:grid-rows-[0fr]");

  fireEvent.wheel(scroller, { deltaY: 100 });
  scroller.scrollTop = 100;
  fireEvent.scroll(scroller);
  fireEvent.wheel(scroller, { deltaY: -100 });
  scroller.scrollTop = 0;
  fireEvent.scroll(scroller);
  expect(header).not.toHaveClass("max-lg:grid-rows-[0fr]");
});

it("leaves other workspace headers fixed", () => {
  const { scroller } = renderShell(false);
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  expect(screen.getByRole("banner")).toHaveClass("contents");
});

it("supports a compact toolbar without hiding the page title from desktop", () => {
  render(<MemoryRouter><AppWorkspaceShell title="Teams and Services" icon={Users} compactMobileToolbar>
    <div>Workspace</div>
  </AppWorkspaceShell></MemoryRouter>);

  const toolbar = screen.getByTestId("app-workspace-toolbar");
  expect(toolbar).toHaveClass("h-[48px]", "min-h-[48px]", "lg:grid-cols-[1fr_auto_1fr]");
  expect(screen.getByTestId("app-workspace-title")).toHaveClass("hidden", "lg:flex");
});
