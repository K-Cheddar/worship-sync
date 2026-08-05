import {
  rebuildMicrophoneAudiences,
  type MicrophonePositionOption,
} from "./ServicePlanMicrophoneManager";

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
