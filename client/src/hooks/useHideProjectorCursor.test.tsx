import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  clearHideProjectorCursorStyle,
  useHideProjectorCursor,
} from "./useHideProjectorCursor";

const HookHost = ({ enabled }: { enabled: boolean }) => {
  useHideProjectorCursor(enabled);
  return <button type="button">projector</button>;
};

const renderOnRoute = (path: string, enabled = true) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path.split("?")[0]} element={<HookHost enabled={enabled} />} />
      </Routes>
    </MemoryRouter>,
  );

describe("useHideProjectorCursor", () => {
  afterEach(() => {
    clearHideProjectorCursorStyle();
  });

  it("hides the cursor on /projector-full while enabled", () => {
    const { unmount } = renderOnRoute("/projector-full");

    expect(getComputedStyle(screen.getByRole("button")).cursor).toBe("none");

    unmount();
    render(<button type="button">after</button>);
    expect(getComputedStyle(screen.getByRole("button")).cursor).not.toBe(
      "none",
    );
  });

  it("hides the cursor on /projector while enabled", () => {
    renderOnRoute("/projector");
    expect(getComputedStyle(screen.getByRole("button")).cursor).toBe("none");
  });

  it("does not hide the cursor on /monitor even when enabled", () => {
    renderOnRoute("/monitor");
    expect(getComputedStyle(screen.getByRole("button")).cursor).not.toBe(
      "none",
    );
  });

  it("does not hide the cursor when disabled", () => {
    renderOnRoute("/projector-full", false);

    expect(getComputedStyle(screen.getByRole("button")).cursor).not.toBe(
      "none",
    );
  });
});
