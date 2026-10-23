import { useCallback } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useTeamsReturnNavigation } from "./useTeamsReturnNavigation";
import { useTeamsTeamSearchParam } from "./useTeamsTeamSearchParam";
import {
  TEAMS_SECTION_PATHS,
  buildSectionReturnTo,
  clearPersistedTeamsReturnTo,
  persistTeamsReturnTo,
  TEAMS_RETURN_STORAGE_KEY,
} from "../teamsReturnNavigation";

const ReturnLabel = () => {
  const { returnTo } = useTeamsReturnNavigation();
  return <p>{returnTo?.label || "No return route"}</p>;
};

const HistoryHarness = () => {
  const { returnTo, finishEditing } = useTeamsReturnNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <button onClick={() => finishEditing()}>Return explicitly</button>
    <button onClick={() => navigate(-1)}>Browser Back</button>
    <button onClick={() => navigate(1)}>Browser Forward</button>
    <p>{returnTo?.label || "No return route"}</p>
    <output>{JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}</output>
  </>;
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

  it.each([false, true])("consumes return metadata in history and preserves unrelated state (HashRouter=%s)", async (useHashRouter) => {
    const user = userEvent.setup();
    const returnTo = buildSectionReturnTo(TEAMS_SECTION_PATHS.groups);
    const entry = {
      pathname: TEAMS_SECTION_PATHS.members, search: "?view=active",
      state: { teamsReturnTo: returnTo, retained: "list-state" },
    };
    const originalUrl = window.location.href;
    const originalState = window.history.state;
    window.history.replaceState({ idx: 0, usr: entry.state }, "", `#${entry.pathname}${entry.search}`);
    const view = render(useHashRouter ? <HashRouter><HistoryHarness /></HashRouter> :
      <MemoryRouter initialEntries={[entry]}><HistoryHarness /></MemoryRouter>);
    try {
      await user.click(screen.getByRole("button", { name: "Return explicitly" }));
      expect(screen.getByRole("status")).toHaveTextContent(TEAMS_SECTION_PATHS.groups);
      expect(sessionStorage.getItem(TEAMS_RETURN_STORAGE_KEY)).toBeNull();
      await user.click(screen.getByRole("button", { name: "Browser Back" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(JSON.stringify({
        pathname: TEAMS_SECTION_PATHS.members, search: "?view=active", state: { retained: "list-state" },
      })));
      expect(screen.getByText("No return route")).toBeInTheDocument();
      expect(sessionStorage.getItem(TEAMS_RETURN_STORAGE_KEY)).toBeNull();
      await user.click(screen.getByRole("button", { name: "Browser Forward" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(TEAMS_SECTION_PATHS.groups));
    } finally {
      view.unmount();
      window.history.replaceState(originalState, "", originalUrl);
    }
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
