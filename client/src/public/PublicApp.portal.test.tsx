import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PublicApp from "./PublicApp";
import { clearVolunteerIngress, scrubVolunteerIngress } from "./volunteerIngress";

const slot = { memberId: "member", name: "Alex Volunteer", isMe: true, scheduleId: "schedule", teamId: "team", teamName: "Media",
  positionId: "camera", positionName: "Camera", columnKey: "camera::0", isPrimary: true, response: "pending" };
const assignment = { occurrenceId: "service@2099-11-01", serviceIds: ["service"], name: "Sunday Gathering", date: "2099-11-01",
  startsAt: "2099-11-01T14:00:00.000Z", serving: [slot], plan: { planId: "plan", name: "Sunday", published: false,
    sections: [{ name: "Welcome", elements: [{ type: "free", title: "Welcome everyone", startTime: "", durationSeconds: 60 }] }] } };
const originalFetch = global.fetch;
let fetchMock: jest.Mock;
let accepted: boolean;
let recovered: boolean;
beforeEach(() => {
  clearVolunteerIngress(); accepted = false; recovered = false;
  window.history.replaceState({}, "", "/s");
  fetchMock = jest.fn(async (path: string) => {
    let result: unknown = { success: true };
    if (path.endsWith("/session")) result = { success: true, csrfToken: "csrf", churchId: "church", memberId: "member", expiresAt: 9e12 };
    if (path.endsWith("/schedule")) result = { success: true, churchName: "Grace Chapel", serviceTimeZone: "America/New_York",
      member: { memberId: "member", firstName: "Alex", lastName: "Volunteer", updatedAt: "stamp", blockoutDates: [] },
      occurrences: [{ ...assignment, serving: [{ ...slot, response: accepted ? "accepted" : "pending" }] }] };
    if (path.endsWith("/availability")) result = { success: true, requests: [] };
    if (path.endsWith("/accept-unanswered")) { accepted = true; result = { success: true, results: [{ scheduleId: "schedule", success: true, applied: 1 }] }; }
    if (path.endsWith("/recovery/start")) result = { success: true, challengeId: "challenge" };
    if (path.endsWith("/recovery/verify")) recovered = true;
    return { ok: true, status: 200, json: async () => result };
  });
  global.fetch = fetchMock;
});
afterEach(() => { global.fetch = originalFetch; clearVolunteerIngress(); });

it("opens the same My Schedule through the real public providers, including deferred time off and plan views", async () => {
  const user = userEvent.setup();
  render(<PublicApp />);
  await screen.findByRole("button", { name: "Accept all unanswered" });
  expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Time off/i }));
  expect(screen.getByRole("button", { name: /Add single day/i })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Accept all unanswered" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Accept all unanswered" })).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /Open Sunday Gathering/i }));
  await user.click(screen.getByRole("tab", { name: /Service plan/i }));
  expect(await screen.findByText("Welcome everyone")).toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([path]) => String(path).startsWith("/api/volunteer/"))).toBe(true);
  const operationCalls = fetchMock.mock.calls.filter(([path]) => !String(path).endsWith("/session"));
  expect(operationCalls.every(([, options]) => options.credentials === "include" && options.cache === "no-store" && !options.headers.authorization)).toBe(true);
});

it("cleans the fragment and completes expired-link verification before restoring the shared schedule", async () => {
  const user = userEvent.setup();
  const token = `v_${"x".repeat(32)}`;
  window.history.replaceState({}, "", `/s#${token}`); scrubVolunteerIngress();
  expect(window.location.hash).toBe("");
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (path: string, options: RequestInit) => {
    if (path.endsWith("/redeem") && !recovered) return { ok: false, status: 410, json: async () => ({ accessStatus: "expired" }) };
    return normal(path, options);
  });
  render(<PublicApp />);
  await user.click(await screen.findByRole("button", { name: "Verify identity" }));
  await user.type(await screen.findByLabelText(/Verification code/i), "123456");
  await user.click(screen.getByRole("button", { name: "Verify and open My Schedule" }));
  expect(await screen.findByRole("button", { name: /Open Sunday Gathering/i })).toBeInTheDocument();
  const sent = fetchMock.mock.calls.find(([path]) => String(path).endsWith("/recovery/start"));
  expect(JSON.parse(sent?.[1].body as string).token).toBe(token);
});
