import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ScheduleMicrophoneSelect from "./ScheduleMicrophoneSelect";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";

const microphones: ServicePlanMicrophone[] = [
  { id: "mic-lead", name: "Lead", type: "Handheld", color: "#9ca3af" },
];

describe("ScheduleMicrophoneSelect", () => {
  it("links to the church Microphones page when the catalog is empty", () => {
    render(
      <MemoryRouter>
        <ScheduleMicrophoneSelect
          microphones={[]}
          holdersByMicrophone={new Map()}
          slotKey="pos-lead::0"
          ariaLabel="Microphone for Lead"
          canEdit
          onChange={jest.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/No microphones configured/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Open Microphones$/i }),
    ).toHaveAttribute("href", TEAMS_SECTION_PATHS.microphones);
  });

  it("does not show the Microphones link when the catalog has items", () => {
    render(
      <MemoryRouter>
        <ScheduleMicrophoneSelect
          microphones={microphones}
          holdersByMicrophone={new Map()}
          slotKey="pos-lead::0"
          ariaLabel="Microphone for Lead"
          canEdit
          onChange={jest.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("link", { name: /^Open Microphones$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /Microphone for Lead/i }),
    ).toBeInTheDocument();
  });
});
