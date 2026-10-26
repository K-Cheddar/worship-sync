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

const SavingSource = ({ isSaving }: { isSaving: boolean }) => {
  const { setSavingSource } = useTeamsNavigationGuard();

  useEffect(() => {
    setSavingSource("saving", isSaving);
    const finishSave = () => setSavingSource("saving", false);
    window.addEventListener("finish-saving", finishSave);
    return () => {
      window.removeEventListener("finish-saving", finishSave);
      setSavingSource("saving", false);
    };
  }, [isSaving, setSavingSource]);

  return null;
};

const GuardHarness = () => {
  const [showFirstSource, setShowFirstSource] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { requestNavigation } = useTeamsNavigationGuard();

  return (
    <>
      {showFirstSource ? <DirtySource sourceId="first" /> : null}
      <DirtySource sourceId="second" />
      <SavingSource isSaving={isSaving} />
      <button type="button" onClick={() => setShowFirstSource(false)}>
        Unmount first form
      </button>
      <button type="button" onClick={() => requestNavigation("/members")}>
        Leave Teams
      </button>
      <button type="button" onClick={() => setIsSaving((current) => !current)}>
        Toggle save
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
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(goSpy).toHaveBeenLastCalledWith(-1);

    goSpy.mockRestore();
    window.history.replaceState(originalState, "", originalUrl);
  });

  it("blocks leaving while a save is running and restores the dirty guard afterward", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <GuardHarness />
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Toggle save" }));
    await user.click(screen.getByRole("button", { name: "Leave Teams" }));

    expect(screen.getByRole("dialog", { name: "Saving changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();

    fireEvent(window, new Event("finish-saving"));

    expect(screen.queryByRole("dialog", { name: "Saving changes" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Leave Teams" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });
});
