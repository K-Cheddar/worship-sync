import { render, screen } from "@testing-library/react";
import { ServicePlanMicrophoneChip } from "./ServicePlanMicrophoneChip";

describe("ServicePlanMicrophoneChip", () => {
  it("shows the microphone type next to the name and tints from catalog color", () => {
    render(
      <ServicePlanMicrophoneChip
        microphone={{
          id: "mic-orange",
          name: "Orange",
          type: "Handheld",
          color: "#f97316",
        }}
        details={["Jamie"]}
      />,
    );

    const chip = screen.getByLabelText("Orange · Handheld · Jamie");
    expect(chip).toHaveStyle({
      color: "rgb(255, 255, 255)",
    });
    expect(chip.style.borderColor).toBe("rgba(249, 115, 22, 0.45)");
    expect(chip.style.backgroundColor).toBe("rgba(249, 115, 22, 0.14)");
    expect(screen.getByText("Orange")).toBeInTheDocument();
    expect(screen.getByText(/Handheld · Jamie/)).toBeInTheDocument();
    expect(chip).not.toHaveClass("truncate");
    expect(chip.className).not.toMatch(/max-w-/);
  });

  it("keeps the violet fallback when the microphone has no color", () => {
    render(
      <ServicePlanMicrophoneChip
        microphone={{
          id: "mic-plain",
          name: "Spare",
          type: "Handheld",
          color: "",
        }}
      />,
    );

    const chip = screen.getByLabelText("Spare · Handheld");
    expect(chip).toHaveClass("border-violet-500/30");
    expect(chip).toHaveClass("bg-violet-950/40");
    expect(chip).toHaveClass("text-violet-100");
  });

  it("adds right padding when a remove control is present", () => {
    render(
      <ServicePlanMicrophoneChip
        microphone={{
          id: "mic-gray",
          name: "Gray",
          type: "Headset",
          color: "#9ca3af",
        }}
      >
        <button type="button" aria-label="Remove Gray">
          ×
        </button>
      </ServicePlanMicrophoneChip>,
    );

    expect(screen.getByLabelText("Gray · Headset")).toHaveClass("pr-2");
  });
});
