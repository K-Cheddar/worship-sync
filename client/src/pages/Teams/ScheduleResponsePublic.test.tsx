import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ScheduleResponsePublic from "./ScheduleResponsePublic";
import {
  getAssignmentResponseContext,
  respondToAssignmentByToken,
} from "../../api/auth";

jest.mock("../../api/auth", () => ({
  getAssignmentResponseContext: jest.fn(),
  respondToAssignmentByToken: jest.fn(),
  AuthApiError: class AuthApiError extends Error {
    status?: number;
  },
}));

const mockGetContext = jest.mocked(getAssignmentResponseContext);
const mockRespond = jest.mocked(respondToAssignmentByToken);

const slot = (overrides = {}) => ({
  occurrenceId: "svc@2099-09-06",
  cellKey: "camera::0",
  serviceName: "Sunday Gathering",
  startsAt: "2099-09-06T15:00:00.000Z",
  positionName: "Camera",
  response: "pending" as const,
  ...overrides,
});

const context = (assignments: unknown[]) =>
  mockGetContext.mockResolvedValue({
    success: true,
    churchName: "Northside",
    firstName: "Kevin",
    assignments,
  } as unknown as Awaited<ReturnType<typeof getAssignmentResponseContext>>);

const answered = (assignments: unknown[]) =>
  mockRespond.mockResolvedValue({
    success: true,
    response: "accepted",
    applied: assignments.length,
    assignments,
  } as unknown as Awaited<ReturnType<typeof respondToAssignmentByToken>>);

const renderPage = (search = "") =>
  render(
    <MemoryRouter initialEntries={[`/schedule-response/tok-1${search}`]}>
      <Routes>
        <Route
          path="/schedule-response/:token"
          element={<ScheduleResponsePublic />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe("ScheduleResponsePublic", () => {
  beforeEach(() => jest.clearAllMocks());

  it("names the services it is asking about", async () => {
    // The first version asked "Can you serve at this service?" and named none —
    // a question the reader had no way to answer.
    context([slot(), slot({ occurrenceId: "svc2", serviceName: "Evening" })]);
    renderPage();

    expect(await screen.findByText("Sunday Gathering")).toBeInTheDocument();
    expect(screen.getByText("Evening")).toBeInTheDocument();
    expect(mockRespond).not.toHaveBeenCalled();
  });

  // One click in the email is the answer. The write happens here rather than on
  // the server's GET so mail-security scanners, which fetch links but do not run
  // this app, cannot answer on the reader's behalf.
  it("applies the answer clicked in the email, exactly once", async () => {
    context([slot()]);
    answered([slot({ response: "accepted" })]);
    renderPage("?respond=accepted");

    await screen.findByText(/your team lead has your answer/i);
    expect(mockRespond).toHaveBeenCalledTimes(1);
    expect(mockRespond).toHaveBeenCalledWith({
      token: "tok-1",
      response: "accepted",
    });
    expect(screen.getByText(/You said: Accepted/i)).toBeInTheDocument();
  });

  it("ignores an unrecognised intent instead of guessing", async () => {
    context([slot()]);
    renderPage("?respond=maybe");

    await screen.findByText("Sunday Gathering");
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it("answers every service at once when asked", async () => {
    const two = [slot(), slot({ occurrenceId: "svc2", serviceName: "Evening" })];
    context(two);
    answered(two.map((entry) => ({ ...entry, response: "declined" })));
    renderPage();

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /Decline all/i }),
    );

    expect(mockRespond).toHaveBeenCalledWith({
      token: "tok-1",
      response: "declined",
    });
  });

  it("surfaces an expired link with the server's next step", async () => {
    mockGetContext.mockRejectedValue(
      Object.assign(new Error("This link has expired. Ask your team lead."), {
        status: 410,
      }),
    );
    renderPage();

    expect(
      await screen.findByText(/This link has expired/i),
    ).toBeInTheDocument();
  });
});
