import { render, screen } from "@testing-library/react";
import { ServicePlanMicrophoneChip } from "./ServicePlanMicrophoneChip";

describe("ServicePlanMicrophoneChip", () => {
  it("tints the chip chrome from the microphone catalog color", () => {
    render(
      <ServicePlanMicrophoneChip
        microphone={{
          id: "mic-orange",
          name: "Orange",
          type: "Handheld",
          color: "#f97316",
        }}
        details={["Handheld", "Jamie"]}
      />,
    );

    const chip = screen.getByLabelText("Orange · Handheld · Jamie");
    expect(chip).toHaveStyle({
      color: "rgb(255, 255, 255)",
    });
    expect(chip.style.borderColor).toBe("rgba(249, 115, 22, 0.45)");
    expect(chip.style.backgroundColor).toBe("rgba(249, 115, 22, 0.14)");
    expect(screen.getByText(/Handheld · Jamie/)).toBeInTheDocument();
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

    const chip = screen.getByLabelText("Spare");
    expect(chip).toHaveClass("border-violet-500/30");
    expect(chip).toHaveClass("bg-violet-950/40");
    expect(chip).toHaveClass("text-violet-100");
  });
});
