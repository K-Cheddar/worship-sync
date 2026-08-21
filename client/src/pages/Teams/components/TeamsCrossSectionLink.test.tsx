import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TeamsCrossSectionLink from "./TeamsCrossSectionLink";
import {
  TeamsNavigationGuardProvider,
  useTeamsNavigationGuard,
} from "../TeamsNavigationGuardContext";
import {
  TEAMS_SECTION_PATHS,
  buildSectionReturnTo,
  clearPersistedTeamsReturnTo,
  readPersistedTeamsReturnTo,
} from "../teamsReturnNavigation";

const returnTo = buildSectionReturnTo(TEAMS_SECTION_PATHS.members);

const DirtySource = () => {
  const { setDirtySource } = useTeamsNavigationGuard();

  useEffect(() => {
    setDirtySource("member", true);
    return () => setDirtySource("member", false);
  }, [setDirtySource]);

  return null;
};

const renderLink = ({ dirty = false }: { dirty?: boolean } = {}) =>
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.members]}>
      <TeamsNavigationGuardProvider>
        {dirty ? <DirtySource /> : null}
        <TeamsCrossSectionLink
          to={`${TEAMS_SECTION_PATHS.positions}?teamId=team-1`}
          returnTo={returnTo}
        >
          Edit position
        </TeamsCrossSectionLink>
      </TeamsNavigationGuardProvider>
    </MemoryRouter>,
  );

describe("TeamsCrossSectionLink", () => {
  beforeEach(() => {
    clearPersistedTeamsReturnTo();
  });

  it("persists a return route only after a navigation completes", async () => {
    const user = userEvent.setup();
    renderLink();

    expect(
      readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.positions),
    ).toBeNull();

    await user.click(screen.getByRole("link", { name: "Edit position" }));

    expect(
      readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.positions),
    ).toEqual(returnTo);
  });

  it("does not leave return state behind when navigation is cancelled", async () => {
    const user = userEvent.setup();
    renderLink({ dirty: true });

    await user.click(screen.getByRole("link", { name: "Edit position" }));

    expect(
      screen.getByRole("dialog", { name: "Unsaved changes" }),
    ).toBeInTheDocument();
    expect(
      readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.positions),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Stay" }));

    expect(
      readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.positions),
    ).toBeNull();
  });
});
