import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import VolunteerNavigationLink, {
  VolunteerNavigationGuardProvider,
  useVolunteerNavigationGuard,
} from "./VolunteerNavigationGuard";

let changeSavingState: (saving: boolean) => void = () => undefined;

const GuardHarness = () => {
  const { setDirtySource, setSavingSource } = useVolunteerNavigationGuard();

  useEffect(() => {
    changeSavingState = (saving) => setSavingSource("save", saving);
    setDirtySource("form", true);
    return () => {
      setDirtySource("form", false);
      setSavingSource("save", false);
      changeSavingState = () => undefined;
    };
  }, [setDirtySource, setSavingSource]);

  return (
    <>
      <button type="button" onClick={() => setSavingSource("save", true)}>
        Start saving
      </button>
      <VolunteerNavigationLink to="/other">Leave page</VolunteerNavigationLink>
    </>
  );
};

it("clears a dismissed saving warning when a save finishes", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/current"]}>
      <VolunteerNavigationGuardProvider>
        <GuardHarness />
      </VolunteerNavigationGuardProvider>
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "Start saving" }));
  await user.click(screen.getByRole("link", { name: "Leave page" }));
  expect(await screen.findByRole("dialog", { name: "Saving changes" })).toBeInTheDocument();

  await act(async () => changeSavingState(false));
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Saving changes" })).not.toBeInTheDocument();
  });

  await act(async () => changeSavingState(true));
  expect(screen.queryByRole("dialog", { name: "Saving changes" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Leave page" }));
  expect(await screen.findByRole("dialog", { name: "Saving changes" })).toBeInTheDocument();
});
