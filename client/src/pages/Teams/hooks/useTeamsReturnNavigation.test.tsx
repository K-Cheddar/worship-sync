import { useCallback } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useTeamsReturnNavigation } from "./useTeamsReturnNavigation";
import { useTeamsTeamSearchParam } from "./useTeamsTeamSearchParam";
import {
  TEAMS_SECTION_PATHS,
  buildSectionReturnTo,
  clearPersistedTeamsReturnTo,
  persistTeamsReturnTo,
} from "../teamsReturnNavigation";

const ReturnLabel = () => {
  const { returnTo } = useTeamsReturnNavigation();
  return <p>{returnTo?.label || "No return route"}</p>;
};

const QueryCleanupHarness = () => {
  const { returnTo } = useTeamsReturnNavigation();
  const location = useLocation();
  const setTeamId = useCallback(() => undefined, []);
  useTeamsTeamSearchParam(["team-1"], setTeamId);

  return (
    <>
      <p>{returnTo?.label || "No return route"}</p>
      <p>{location.search || "No query"}</p>
    </>
  );
};

describe("useTeamsReturnNavigation", () => {
  beforeEach(() => {
    clearPersistedTeamsReturnTo();
  });

  it("ignores stale persisted return state during normal in-app navigation", () => {
    persistTeamsReturnTo(
      buildSectionReturnTo(TEAMS_SECTION_PATHS.members),
      TEAMS_SECTION_PATHS.positions,
    );

    render(
      <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.positions]}>
        <ReturnLabel />
      </MemoryRouter>,
    );

    expect(screen.getByText("No return route")).toBeInTheDocument();
  });

  it("keeps a valid return route while stripping a team query parameter", async () => {
    const returnTo = buildSectionReturnTo(TEAMS_SECTION_PATHS.members);

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: TEAMS_SECTION_PATHS.positions,
            search: "?teamId=team-1",
            state: { teamsReturnTo: returnTo },
          },
        ]}
      >
        <QueryCleanupHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No query")).toBeInTheDocument();
    });

    expect(screen.getByText(returnTo.label)).toBeInTheDocument();
  });
});
