import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  rebuildMicrophoneAudiences,
  type MicrophonePositionOption,
} from "./ServicePlanMicrophoneManager";
import ServicePlanMicrophoneManager from "./ServicePlanMicrophoneManager";
import type { ServicePlanMicrophone } from "../../types/servicePlan";

describe("rebuildMicrophoneAudiences", () => {
  it("keeps a selected audience when its position is no longer an option", () => {
    const positionOptions: MicrophonePositionOption[] = [
      {
        positionId: "lead",
        roleName: "Lead",
        label: "Lead",
        teamId: "praise",
        teamName: "Praise team",
      },
    ];
    const unavailableAudience = {
      positionId: "archived-soprano",
      roleName: "Soprano",
      teamId: "praise",
      teamName: "Praise team",
    };

    expect(
      rebuildMicrophoneAudiences(
        ["lead", "archived-soprano"],
        positionOptions,
        [unavailableAudience],
      ),
    ).toEqual([
      {
        positionId: "lead",
        roleName: "Lead",
        teamId: "praise",
        teamName: "Praise team",
      },
      unavailableAudience,
    ]);
  });
});

describe("ServicePlanMicrophoneManager visibility editing", () => {
  const microphones: ServicePlanMicrophone[] = [
    { id: "mic-1", name: "Lead", type: "handheld", color: "#ff6600" },
  ];
  const positionNoteOptions: MicrophonePositionOption[] = [
    {
      positionId: "position-lead",
      roleName: "Lead",
      label: "Lead",
      teamId: "team-worship",
      teamName: "Worship",
    },
  ];

  const openVisibilityEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Mic note visibility" }));
    await user.click(screen.getByRole("button", { name: "Edit visibility" }));
  };

  it("closes visibility editing after a successful save", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(true);
    render(
      <ServicePlanMicrophoneManager
        microphones={microphones}
        microphoneAudiences={[]}
        onSave={onSave}
        positionNoteOptions={positionNoteOptions}
      />,
    );

    await openVisibilityEditor(user);
    await user.click(screen.getByRole("button", { name: "Save visibility" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(microphones, [], "visibility"));
    expect(screen.queryByRole("button", { name: "Save visibility" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit visibility" })).toBeInTheDocument();
  });

  it("keeps visibility editing open when the save callback reports failure", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(false);
    render(
      <ServicePlanMicrophoneManager
        microphones={microphones}
        microphoneAudiences={[]}
        onSave={onSave}
        positionNoteOptions={positionNoteOptions}
      />,
    );

    await openVisibilityEditor(user);
    await user.click(screen.getByRole("button", { name: "Save visibility" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(microphones, [], "visibility"));
    expect(screen.getByRole("button", { name: "Save visibility" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit visibility" })).not.toBeInTheDocument();
  });
});
