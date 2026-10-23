import { openVolunteerSession, VolunteerApiError } from "./volunteer";
import { clearVolunteerIngress, readVolunteerIngress, scrubVolunteerIngress } from "../public/volunteerIngress";

const session = { csrfToken: "synthetic-csrf", churchId: "church", memberId: "member", expiresAt: 9e12 };
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const ingress = (token = "synthetic-personal-link") => {
  window.history.replaceState({}, "", `/s#${token}`);
  scrubVolunteerIngress();
  return token;
};
const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; clearVolunteerIngress(); });

it.each([429, 500, 503])("retains ingress only in memory for an explicit retry after HTTP %s", async (status) => {
  const token = ingress();
  const fetcher = jest.mocked(global.fetch).mockResolvedValueOnce(response({}, status))
    .mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response(session));
  await expect(openVolunteerSession()).rejects.toBeInstanceOf(VolunteerApiError);
  expect(window.location.hash).toBe("");
  expect(readVolunteerIngress()).toBe(token);
  expect(await openVolunteerSession()).toEqual(session);
  expect(readVolunteerIngress()).toBe("");
  expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith("/redeem"))).toHaveLength(2);
});

it.each([
  [400, undefined, true],
  [401, undefined, true],
  [403, undefined, true],
  [403, "revoked", false],
  [404, "invalid", false],
  [410, "expired", true],
])("retains ingress unless the server identifies an invalid or revoked credential (HTTP %s, %s)", async (status, accessStatus, retained) => {
  const token = ingress();
  jest.mocked(global.fetch).mockResolvedValueOnce(response({ accessStatus }, status));
  await expect(openVolunteerSession()).rejects.toBeInstanceOf(VolunteerApiError);
  expect(readVolunteerIngress()).toBe(retained ? token : "");
});

it("retries a lost redemption response without requiring the link to be reopened", async () => {
  const token = ingress();
  jest.mocked(global.fetch).mockRejectedValueOnce(new TypeError("Connection interrupted"))
    .mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response(session));
  await expect(openVolunteerSession()).rejects.toThrow("Connection interrupted");
  expect(readVolunteerIngress()).toBe(token);
  expect(await openVolunteerSession()).toEqual(session);
});

it("uses the durable cookie on retry after redemption succeeded but session lookup failed", async () => {
  ingress();
  const fetcher = jest.mocked(global.fetch).mockResolvedValueOnce(response({ success: true }))
    .mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(session));
  await expect(openVolunteerSession()).rejects.toBeInstanceOf(VolunteerApiError);
  expect(readVolunteerIngress()).toBe("");
  expect(await openVolunteerSession()).toEqual(session);
  expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith("/redeem"))).toHaveLength(1);
});

it("coalesces concurrent redemption and retires it before a different personal link", async () => {
  ingress();
  const fetcher = jest.mocked(global.fetch).mockImplementation(async (path) =>
    response(String(path).endsWith("/session") ? session : { success: true }));
  await Promise.all([openVolunteerSession(), openVolunteerSession()]);
  expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith("/redeem"))).toHaveLength(1);
  const nextToken = ingress("second-synthetic-link");
  await openVolunteerSession();
  const redemptions = fetcher.mock.calls.filter(([path]) => String(path).endsWith("/redeem"));
  expect(redemptions).toHaveLength(2);
  expect(JSON.parse(String(redemptions[1][1]?.body))).toEqual({ token: nextToken });
});

it("does not reuse or return a stale redemption after the personal link changes in flight", async () => {
  const firstToken = ingress("first-personal-link");
  let finishFirstRedemption!: (value: Response) => void;
  const fetcher = jest.mocked(global.fetch).mockImplementation((path, init) => {
    if (String(path).endsWith("/session")) return Promise.resolve(response(session));
    const body = JSON.parse(String(init?.body)) as { token: string };
    if (body.token === firstToken) {
      return new Promise((resolve) => { finishFirstRedemption = resolve; });
    }
    return Promise.resolve(response({ success: true }));
  });
  const firstOpen = openVolunteerSession();
  await waitForMicrotasks();
  const secondToken = ingress("second-personal-link");
  const secondOpen = openVolunteerSession();

  await actAsync(() => finishFirstRedemption(response({ success: true })));
  const [firstSession, secondSession] = await Promise.all([firstOpen, secondOpen]);

  expect(firstSession).toEqual(session);
  expect(secondSession).toEqual(session);
  expect(readVolunteerIngress()).toBe("");
  const redemptions = fetcher.mock.calls.filter(([path]) => String(path).endsWith("/redeem"));
  expect(redemptions).toHaveLength(2);
  expect(JSON.parse(String(redemptions[0][1]?.body))).toEqual({ token: firstToken });
  expect(JSON.parse(String(redemptions[1][1]?.body))).toEqual({ token: secondToken });
});

const waitForMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const actAsync = async (action: () => void) => {
  action();
  await waitForMicrotasks();
};
