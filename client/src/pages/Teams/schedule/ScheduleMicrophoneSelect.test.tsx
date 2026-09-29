import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ScheduleMicrophoneSelect from "./ScheduleMicrophoneSelect";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";
import type { ServiceEquipment } from "../../../types/servicePlan";

const microphones: ServicePlanMicrophone[] = [
  { id: "mic-lead", name: "Lead", type: "Handheld", color: "#9ca3af" },
];

describe("ScheduleMicrophoneSelect", () => {
  it("supports an IEM-only team without rendering a microphone picker", async () => {
    const onIemChange = jest.fn();
    const iems: ServiceEquipment[] = [{ id: "same-id", category: "iem", name: "IEM 3" }];
    render(
      <ScheduleMicrophoneSelect
        microphoneIds={[]}
        microphones={[]}
        holdersByMicrophone={new Map()}
        slotKey="service:position::0"
        ariaLabel="Microphone for Sarah"
        canEdit
        showMicrophones={false}
        iems={iems}
        iemIds={[]}
        onIemChange={onIemChange}
        onChange={() => undefined}
      />,
    );

    expect(screen.queryByLabelText("Microphone for Sarah")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Microphone for Sarah IEM" }));
    await userEvent.click(screen.getByRole("option", { name: /IEM 3/ }));
    expect(onIemChange).toHaveBeenCalledWith(["same-id"]);
  });
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
