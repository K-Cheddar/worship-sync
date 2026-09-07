import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import QualificationManager from "./QualificationManager";
import { ToastProvider } from "../../../context/toastContext";
import { TeamsNavigationGuardProvider, useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import type { TeamRecord } from "../../../api/authTypes";

jest.mock("../../../api/auth", () => ({
  archiveTeamQualificationArea: jest.fn(),
  createTeamQualificationArea: jest.fn(),
  createTeamQualificationLevel: jest.fn(),
  deleteTeamQualificationArea: jest.fn(),
  updateTeamQualificationArea: jest.fn(),
  updateTeamQualificationLevel: jest.fn(),
}));

const activeTeam: TeamRecord = {
  churchId: "church-1",
  teamId: "team-worship",
  name: "Worship",
  memberIds: [],
};

const NavigationProbe = () => {
  const { requestNavigation } = useTeamsNavigationGuard();

  return (
    <button type="button" onClick={() => requestNavigation("/members")}>
      Leave Teams
    </button>
  );
};

describe("QualificationManager navigation guard", () => {
  it("does not report unsaved changes before an editor is opened", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <QualificationManager
              areas={[]}
              levels={[]}
              teams={[activeTeam]}
              canEdit
              onAreaSaved={jest.fn()}
              onLevelSaved={jest.fn()}
              onArchived={jest.fn()}
              onAreaRemoved={jest.fn()}
            />
            <NavigationProbe />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Leave Teams" }));

    expect(
      screen.queryByRole("dialog", { name: "Unsaved changes" }),
    ).not.toBeInTheDocument();
  });
});
