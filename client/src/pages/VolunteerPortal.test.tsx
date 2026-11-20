import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VolunteerPortal from "./VolunteerPortal";
import { openVolunteerSession, VolunteerApiError } from "../api/volunteer";
import { clearVolunteerIngress, readVolunteerIngress, scrubVolunteerIngress } from "../public/volunteerIngress";

jest.mock("../api/volunteer", () => ({
  ...jest.requireActual("../api/volunteer"),
  openVolunteerSession: jest.fn(),
}));
jest.mock("./MySchedule", () => () => <div>My Schedule content</div>);
jest.mock("./MyAvailability", () => () => <div>My Availability content</div>);

const setIngress = (token: string) => {
  window.history.replaceState({}, "", `/s#${token}`);
  scrubVolunteerIngress();
};

const renderPortal = (path = "/s") => render(
  <MemoryRouter initialEntries={[path]}>
    <VolunteerPortal />
  </MemoryRouter>,
);

beforeEach(() => {
  jest.clearAllMocks();
  clearVolunteerIngress();
});

afterEach(() => clearVolunteerIngress());

it("offers an explicit retry instead of identity recovery after a non-authoritative HTTP failure", async () => {
  const token = "synthetic-personal-link";
  setIngress(token);
  jest.mocked(openVolunteerSession).mockRejectedValue(
    new VolunteerApiError("Open your personal link to continue.", 403, {}),
  );

  renderPortal();

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not open My Schedule");
  expect(screen.getByRole("button", { name: "Retry opening My Schedule" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Verify identity" })).not.toBeInTheDocument();
  expect(readVolunteerIngress()).toBe(token);
  expect(window.location.hash).toBe("");
});

it("keeps the expired-link verification path for an authoritative expiration status", async () => {
  const token = "synthetic-expired-link";
  setIngress(token);
  jest.mocked(openVolunteerSession).mockRejectedValue(
    new VolunteerApiError("This personal link expired.", 410, { accessStatus: "expired" }),
  );

  renderPortal();

  expect(await screen.findByText("Verify your identity to open your schedule.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verify identity" })).toBeInTheDocument();
  expect(readVolunteerIngress()).toBe(token);
});

it("opens the accountless availability section for its direct workspace URL", async () => {
  jest.mocked(openVolunteerSession).mockResolvedValue({
    csrfToken: "session-csrf",
    churchId: "church-1",
    memberId: "member-1",
    expiresAt: Date.now() + 60_000,
  });

  renderPortal("/s?view=availability");

  expect(await screen.findByText("My Availability content")).toBeInTheDocument();
});
