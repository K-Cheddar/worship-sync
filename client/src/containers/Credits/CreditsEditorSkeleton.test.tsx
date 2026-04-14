import { render, screen } from "@testing-library/react";
import CreditsEditorSkeleton, {
  CreditsPreviewSkeleton,
} from "./CreditsEditorSkeleton";

describe("CreditsEditorSkeleton", () => {
  it("renders loading status region with test id", () => {
    render(<CreditsEditorSkeleton />);
    const root = screen.getByTestId("credits-editor-skeleton");
    expect(root).toHaveAttribute("role", "status");
    expect(root).toHaveAttribute("aria-busy", "true");
    expect(root).toHaveAttribute("aria-label", "Loading credits");
  });

  it("renders grip and action placeholders when not read-only", () => {
    render(<CreditsEditorSkeleton readOnly={false} />);
    expect(screen.getAllByTestId("credits-skeleton-drag-grip")).toHaveLength(6);
  });

  it("omits grip and row action placeholders when read-only", () => {
    const { unmount } = render(<CreditsEditorSkeleton readOnly={false} />);
    expect(screen.getAllByTestId("credits-skeleton-drag-grip")).toHaveLength(6);
    unmount();
    render(<CreditsEditorSkeleton readOnly />);
    expect(
      screen.queryAllByTestId("credits-skeleton-drag-grip"),
    ).toHaveLength(0);
  });
});

describe("CreditsPreviewSkeleton", () => {
  it("renders preview loading region", () => {
    render(<CreditsPreviewSkeleton />);
    const root = screen.getByTestId("credits-preview-skeleton");
    expect(root).toHaveAttribute("role", "status");
    expect(root).toHaveAttribute("aria-label", "Loading credits preview");
  });
});
