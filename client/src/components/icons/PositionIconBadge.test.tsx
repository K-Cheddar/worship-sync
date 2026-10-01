import { render, screen } from "@testing-library/react";
import PositionIconBadge, {
  getPositionIconColor,
} from "./PositionIconBadge";

describe("PositionIconBadge", () => {
  it("uses the neutral default for legacy and uncolored refs", () => {
    expect(getPositionIconColor("MicVocal")).toBe("#475569");
    expect(getPositionIconColor({ source: "lucide", name: "Camera" })).toBe("#475569");
  });

  it.each([
    ["default", undefined, "#475569", "#ffffff"],
    ["black", "#000000", "#000000", "#ffffff"],
    ["white", "#ffffff", "#ffffff", "#000000"],
    ["dark blue", "#312e81", "#312e81", "#ffffff"],
    ["light yellow", "#fef08a", "#fef08a", "#000000"],
  ])("uses the fill and contrasting ink for %s", (_label, color, fill, ink) => {
    render(
      <PositionIconBadge
        icon={{
          source: "lucide",
          name: "Camera",
          ...(color ? { color } : {}),
        }}
        data-testid="position-icon-badge"
      />,
    );

    expect(screen.getByTestId("position-icon-badge")).toHaveStyle({
      backgroundColor: fill,
      color: ink,
    });
  });

  it("allows candidate previews to use a fill without changing their refs", () => {
    const icon = { source: "lucide", name: "Camera" } as const;
    render(<PositionIconBadge icon={icon} color="#22c55e" data-testid="preview-badge" />);
    expect(screen.getByTestId("preview-badge")).toHaveStyle({ backgroundColor: "#22c55e" });
    expect(icon).not.toHaveProperty("color");
  });
});
