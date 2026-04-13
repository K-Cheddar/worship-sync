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
    const { container } = render(<CreditsEditorSkeleton readOnly={false} />);
    const pulseBlocks = container.querySelectorAll(".animate-pulse");
    expect(pulseBlocks.length).toBeGreaterThan(0);
  });

  it("omits grip and row action placeholders when read-only", () => {
    const { container: editable } = render(<CreditsEditorSkeleton readOnly={false} />);
    const { container: readOnly } = render(<CreditsEditorSkeleton readOnly />);
    expect(editable.querySelectorAll(".size-5").length).toBeGreaterThan(
      readOnly.querySelectorAll(".size-5").length,
    );
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
