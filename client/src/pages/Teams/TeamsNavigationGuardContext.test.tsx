import { useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, MemoryRouter } from "react-router-dom";
import {
  TeamsNavigationGuardProvider,
  useTeamsNavigationGuard,
} from "./TeamsNavigationGuardContext";

const DirtySource = ({ sourceId }: { sourceId: string }) => {
  const { setDirtySource } = useTeamsNavigationGuard();

  useEffect(() => {
    setDirtySource(sourceId, true);
    return () => setDirtySource(sourceId, false);
  }, [setDirtySource, sourceId]);

  return null;
};

const GuardHarness = () => {
  const [showFirstSource, setShowFirstSource] = useState(true);
  const { requestNavigation } = useTeamsNavigationGuard();

  return (
    <>
      {showFirstSource ? <DirtySource sourceId="first" /> : null}
      <DirtySource sourceId="second" />
      <button type="button" onClick={() => setShowFirstSource(false)}>
        Unmount first form
      </button>
      <button type="button" onClick={() => requestNavigation("/members")}>
        Leave Teams
      </button>
    </>
  );
};

describe("TeamsNavigationGuardProvider", () => {
  it("keeps the guard active when one of multiple dirty forms unmounts", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <GuardHarness />
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Unmount first form" }));
    await user.click(screen.getByRole("button", { name: "Leave Teams" }));

    expect(
      screen.getByRole("dialog", { name: "Unsaved changes" }),
    ).toBeInTheDocument();
  });

  it("confirms before a HashRouter history navigation discards a dirty form", () => {
    const originalUrl = window.location.href;
    const originalState = window.history.state;
    const goSpy = jest.spyOn(window.history, "go").mockImplementation(() => undefined);
    window.history.replaceState({ idx: 2 }, "", "#/teams-and-services/members");

    render(
      <HashRouter>
        <TeamsNavigationGuardProvider>
          <DirtySource sourceId="member" />
        </TeamsNavigationGuardProvider>
      </HashRouter>,
    );

    fireEvent.popState(window, { state: { idx: 1 } });

    expect(
      screen.getByRole("dialog", { name: "Unsaved changes" }),
    ).toBeInTheDocument();
    expect(goSpy).toHaveBeenCalledWith(1);

    goSpy.mockRestore();
    window.history.replaceState(originalState, "", originalUrl);
  });
});
