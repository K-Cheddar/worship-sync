import { render, screen } from "@testing-library/react";
import { useHideProjectorCursor } from "./useHideProjectorCursor";

const HookHost = ({ enabled }: { enabled: boolean }) => {
  useHideProjectorCursor(enabled);
  return <button type="button">projector</button>;
};

describe("useHideProjectorCursor", () => {
  it("hides the cursor while an activated projector is mounted", () => {
    const { unmount } = render(<HookHost enabled />);

    expect(getComputedStyle(screen.getByRole("button")).cursor).toBe("none");

    unmount();
    render(<button type="button">after</button>);
    expect(getComputedStyle(screen.getByRole("button")).cursor).not.toBe(
      "none",
    );
  });

  it("does not hide the cursor when disabled", () => {
    render(<HookHost enabled={false} />);

    expect(getComputedStyle(screen.getByRole("button")).cursor).not.toBe(
      "none",
    );
  });
});
