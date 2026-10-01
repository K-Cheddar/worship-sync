import { render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import {
  rebuildMicrophoneAudiences,
  type MicrophonePositionOption,
} from "./ServicePlanMicrophoneManager";
import ServicePlanMicrophoneManager from "./ServicePlanMicrophoneManager";
import type {
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
} from "../../types/servicePlan";

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

  const renderWithPersistedAudiences = (
    onSave: (
      microphones: ServicePlanMicrophone[],
      audiences: ServicePlanMicrophoneAudience[],
      target: "microphones" | "visibility",
    ) => Promise<boolean>,
  ) => {
    const Harness = () => {
      const [audiences, setAudiences] = useState<ServicePlanMicrophoneAudience[]>([]);
      return (
        <ServicePlanMicrophoneManager
          microphones={microphones}
          microphoneAudiences={audiences}
          onSave={async (nextMicrophones, nextAudiences, target) => {
            const saved = await onSave(nextMicrophones, nextAudiences, target);
            if (saved && target === "visibility") setAudiences(nextAudiences);
            return saved;
          }}
          positionNoteOptions={positionNoteOptions}
        />
      );
    };
    return render(<Harness />);
  };

  const openVisibilityEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Mic note visibility" }));
    await user.click(screen.getByRole("button", { name: "Edit visibility" }));
  };

  it("shows Close and Saved while clean, then Cancel and Save after a visibility edit", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(true);
    renderWithPersistedAudiences(onSave);

    await openVisibilityEditor(user);
    expect(within(screen.getByRole("dialog", { name: "Mic note visibility" })).getAllByRole("button", { name: "Close" })[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Lead" }));
    expect(screen.getByRole("checkbox", { name: "Lead" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save visibility" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(microphones, [
      { positionId: "position-lead", roleName: "Lead", teamId: "team-worship", teamName: "Worship" },
    ], "visibility"));
    const savedButton = screen.getByRole("button", { name: "Saved" });
    expect(savedButton).toBeDisabled();
    expect(screen.getByTestId("service-plan-visibility-save-success-icon")).toHaveClass("text-emerald-300");
  });

  it("keeps visibility editing open when the save callback reports failure", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(false);
    renderWithPersistedAudiences(onSave);

    await openVisibilityEditor(user);
    await user.click(screen.getByRole("checkbox", { name: "Lead" }));
    await user.click(screen.getByRole("button", { name: "Save visibility" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(microphones, [
      { positionId: "position-lead", roleName: "Lead", teamId: "team-worship", teamName: "Worship" },
    ], "visibility"));
    expect(screen.getByRole("button", { name: "Save visibility" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit visibility" })).not.toBeInTheDocument();
  });
});
