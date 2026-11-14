import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthApiError } from "../../../api/auth";
import type { TeamRosterMember, TeamService } from "../../../api/authTypes";
import MemberServiceAvailabilityEditor from "./MemberServiceAvailabilityEditor";

const mockGetAvailability = jest.fn();
const mockUpdateAvailability = jest.fn();

jest.mock("../../../api/auth", () => ({
  AuthApiError: class MockAuthApiError extends Error {
    status?: number;
    constructor(message: string, options: { status?: number } = {}) {
      super(message);
      this.status = options.status;
    }
  },
  getTeamRosterMemberServiceAvailability: (...args: unknown[]) => mockGetAvailability(...args),
  updateTeamRosterMemberServiceAvailability: (...args: unknown[]) => mockUpdateAvailability(...args),
}));

const churchId = "church-1";
const member: TeamRosterMember = {
  memberId: "member-1",
  churchId,
  firstName: "Rae",
  lastName: "Kim",
  positionIds: [],
  blockoutDates: [],
  updatedAt: "revision-1",
};

const makeService = (startsAt: string): TeamService => ({
  id: "sunday",
  serviceId: "sunday",
  churchId,
  name: "Sunday service",
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO: startsAt,
});

const renderEditor = ({
  availability = {},
  availabilityForOccurrence,
}: {
  availability?: TeamRosterMember["serviceAvailability"];
  availabilityForOccurrence?: "available" | "unavailable";
} = {}) => {
  const startsAtDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  startsAtDate.setUTCHours(15, 0, 0, 0);
  const startsAt = startsAtDate.toISOString();
  const occurrenceId = `sunday@${startsAt.slice(0, 10)}`;
  const serviceAvailability = {
    ...availability,
    ...(availabilityForOccurrence ? { [occurrenceId]: availabilityForOccurrence } : {}),
  };
  const onSaved = jest.fn();
  const onDirtyChange = jest.fn();
  const view = render(
    <MemberServiceAvailabilityEditor
      churchId={churchId}
      member={{ ...member, serviceAvailability }}
      services={[makeService(startsAt)]}
      schedules={[]}
      timeZone="UTC"
      timeZoneStatus="ready"
      disabled={false}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
    />,
  );
  return { ...view, occurrenceId, startsAt, onSaved, onDirtyChange };
};

beforeEach(() => {
  mockGetAvailability.mockReset();
  mockUpdateAvailability.mockReset();
});

it("changes a previous intake response and confirms only the availability patch", async () => {
  const user = userEvent.setup();
  const { occurrenceId, onSaved } = renderEditor({
    availability: { elsewhere: "unavailable" },
    availabilityForOccurrence: "available",
  });
  mockUpdateAvailability.mockResolvedValue({
    success: true,
    serviceAvailability: { elsewhere: "unavailable", [occurrenceId]: "unavailable" },
    updatedAt: "revision-2",
  });
  await user.click(screen.getByText("Service availability"));
  const service = screen.getByRole("listitem");
  const control = within(service).getByRole("combobox", { name: /Availability for Sunday service/ });
  expect(control).toHaveTextContent("Available");
  await user.click(control);
  await user.click(screen.getByRole("option", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Save availability" }));

  await waitFor(() => expect(mockUpdateAvailability).toHaveBeenCalledTimes(1));
  expect(mockUpdateAvailability).toHaveBeenCalledWith(churchId, member.memberId, {
    expectedUpdatedAt: member.updatedAt,
    changes: [expect.objectContaining({
      occurrenceId,
      logicalOccurrenceId: occurrenceId,
      status: "unavailable",
      serviceDate: occurrenceId.slice("sunday@".length),
    })],
  });
  expect(mockUpdateAvailability.mock.calls[0][2]).not.toHaveProperty("firstName");
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
    serviceAvailability: expect.objectContaining({ elsewhere: "unavailable" }),
    updatedAt: "revision-2",
  })));
});

it("clears an explicit response when Not set is selected", async () => {
  const user = userEvent.setup();
  const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(15, 0, 0, 0);
  const occurrenceId = `sunday@${startsAt.toISOString().slice(0, 10)}`;
  const { occurrenceId: renderedOccurrenceId } = renderEditor({
    availability: { elsewhere: "unavailable" },
    availabilityForOccurrence: "available",
  });
  mockUpdateAvailability.mockResolvedValue({
    success: true,
    serviceAvailability: { elsewhere: "unavailable" },
    updatedAt: "revision-3",
  });
  expect(renderedOccurrenceId).toBe(occurrenceId);
  await user.click(screen.getByText("Service availability"));
  const service = screen.getByRole("listitem");
  const control = within(service).getByRole("combobox", { name: /Availability for Sunday service/ });
  expect(control).toHaveTextContent("Available");
  await user.click(control);
  await user.click(screen.getByRole("option", { name: "Not set" }));
  await user.click(screen.getByRole("button", { name: "Save availability" }));

  await waitFor(() => expect(mockUpdateAvailability).toHaveBeenCalledWith(
    churchId,
    member.memberId,
    expect.objectContaining({
      changes: [expect.objectContaining({
        occurrenceId,
        status: null,
        removeOccurrenceIds: expect.arrayContaining([occurrenceId]),
      })],
    }),
  ));
});

it("keeps edits after a stale revision and refreshes saved values for review", async () => {
  const user = userEvent.setup();
  mockUpdateAvailability.mockRejectedValueOnce(new AuthApiError("Stale member", { status: 409 }));
  mockGetAvailability.mockResolvedValue({
    success: true,
    serviceAvailability: { elsewhere: "unavailable" },
    updatedAt: "revision-2",
  });
  renderEditor();
  await user.click(screen.getByText("Service availability"));
  const service = screen.getByRole("listitem");
  const control = within(service).getByRole("combobox", { name: /Availability for Sunday service/ });
  await user.click(control);
  await user.click(screen.getByRole("option", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Save availability" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/changed elsewhere/i);
  expect(control).toHaveTextContent("Unavailable");
  await user.click(screen.getByRole("button", { name: "Refresh and review" }));
  expect(await screen.findByText(/latest saved values are loaded/i)).toBeInTheDocument();
  expect(screen.getByText(/Saved now: Not set. Your edit: Unavailable./)).toBeInTheDocument();
  expect(control).toHaveTextContent("Unavailable");
});
