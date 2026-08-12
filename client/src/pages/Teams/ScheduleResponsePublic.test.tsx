import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ScheduleResponsePublic from "./ScheduleResponsePublic";
import {
  getAssignmentResponseContext,
  requestAccountFromAssignmentToken,
  respondToAssignmentByToken,
} from "../../api/auth";

jest.mock("../../api/auth", () => ({
  getAssignmentResponseContext: jest.fn(),
  requestAccountFromAssignmentToken: jest.fn(),
  respondToAssignmentByToken: jest.fn(),
  AuthApiError: class AuthApiError extends Error {
    status?: number;
  },
}));

const mockGetContext = jest.mocked(getAssignmentResponseContext);
const mockRespond = jest.mocked(respondToAssignmentByToken);
const mockRequestAccount = jest.mocked(requestAccountFromAssignmentToken);

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

  // The invite is only offered after answering: the email has one job, and an
  // account pitch competing with Accept/Decline costs answers.
  it("offers an account only once the reader has answered", async () => {
    context([slot()]);
    renderPage();

    await screen.findByText("Sunday Gathering");
    expect(
      screen.queryByRole("button", { name: /Email me an invite/i }),
    ).not.toBeInTheDocument();
  });

  it("treats a previously answered link as answered when reopened", async () => {
    // No `?respond=` — someone returning to the bare link days later. The slots
    // already say "You said: Accepted", so the page must not ask again, and the
    // account offer must not be hidden for good.
    context([slot({ response: "accepted" })]);
    renderPage();

    expect(
      await screen.findByText(/your team lead has your answer/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Email me an invite/i }),
    ).toBeInTheDocument();
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it("asks for an invite with the token alone and names the inbox", async () => {
    context([slot()]);
    answered([slot({ response: "accepted" })]);
    mockRequestAccount.mockResolvedValue({
      success: true,
      email: "vol@church.test",
    } as unknown as Awaited<
      ReturnType<typeof requestAccountFromAssignmentToken>
    >);
    renderPage("?respond=accepted");

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /Email me an invite/i }),
    );

    // No email field exists to send, and none is sent: the address comes from
    // the roster record on the server, or a public endpoint becomes a way to
    // mail anyone.
    expect(mockRequestAccount).toHaveBeenCalledWith("tok-1");
    expect(
      await screen.findByText(/Invite sent to vol@church.test/i),
    ).toBeInTheDocument();
  });

  it("keeps the reader's next step when the invite is refused", async () => {
    context([slot()]);
    answered([slot({ response: "accepted" })]);
    mockRequestAccount.mockRejectedValue(
      Object.assign(
        new Error("You already have an account here. Sign in with your email."),
        { status: 409 },
      ),
    );
    renderPage("?respond=accepted");

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /Email me an invite/i }),
    );

    // "Already have one" and "we have no address for you" need different next
    // steps, so the server's wording is shown rather than a generic failure.
    expect(
      await screen.findByText(/You already have an account here/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Email me an invite/i }),
    ).toBeEnabled();
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
