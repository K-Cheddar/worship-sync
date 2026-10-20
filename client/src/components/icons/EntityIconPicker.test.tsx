import { fireEvent, render, screen } from "@testing-library/react";
import EntityIconPicker from "./EntityIconPicker";

describe("shared entity icon picker", () => {
  it("uses caller-provided recommendations and selects from them", () => {
    const onChange = jest.fn();
    render(
      <EntityIconPicker
        label="Controller icon"
        value=""
        recommendedGroups={[
          {
            label: "Presentation and display",
            icons: [{ source: "lucide", name: "MonitorPlay" }],
          },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Controller icon picker" }));
    expect(screen.getByRole("heading", { name: "Presentation and display" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Monitor Play" }));
    expect(onChange).toHaveBeenCalledWith({ source: "lucide", name: "MonitorPlay" });
  });

  it("keeps the Teams context recommendations when no groups are supplied", () => {
    render(<EntityIconPicker label="Team icon" context="team" value="" onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Team icon picker" }));
    expect(screen.getByRole("heading", { name: "Music & Praise" })).toBeInTheDocument();
  });
});
