import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanningCenterService,
  safePlanningCenterReturnTo,
} from "./planningCenterService.js";

test("safePlanningCenterReturnTo accepts only local application paths", () => {
  assert.equal(
    safePlanningCenterReturnTo(
      "/account/integrations?source=planning-center#connection",
    ),
    "/account/integrations?source=planning-center#connection",
  );

  for (const unsafeValue of [
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "/%2f%2fevil.example",
    "/%5c%5cevil.example",
    "https://evil.example",
    "/malformed%",
  ]) {
    assert.equal(
      safePlanningCenterReturnTo(unsafeValue),
      "/account/integrations",
      unsafeValue,
    );
  }
});

const createConnectedService = async ({ getHandler, userInfoResponses, now } = {}) => {
  const calls = [];
  let profileResponseIndex = 0;
  const httpClient = {
    async post(url, body) {
      calls.push({ method: "post", url, body });
      if (url.endsWith("/oauth/token")) {
        return {
          data: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 7200,
            scope: "people services",
          },
        };
      }
      if (url.endsWith("/oauth/revoke")) {
        return { data: {} };
      }
      throw new Error(`Unexpected POST ${url}`);
    },
    async get(url, config) {
      calls.push({ method: "get", url, params: config?.params });
      if (url.endsWith("/oauth/userinfo")) {
        const profile = userInfoResponses?.[profileResponseIndex++];
        if (profile instanceof Error) throw profile;
        return {
          data: profile || {
            name: "Jordan Admin",
            organization_name: "Example Church",
            organization_id: "org-123",
          },
        };
      }
      const handled = await getHandler?.(url, config);
      if (handled) return handled;
      throw new Error(`Unexpected GET ${url}`);
    },
  };

  const service = createPlanningCenterService({
    getFirestore: () => null,
    getRealtimeDatabase: () => null,
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    redirectBaseUrl: "https://worshipsync.test",
    httpClient,
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenEncryptionKey: "a-test-encryption-secret-that-is-not-checked-in",
    ...(now ? { now } : {}),
  });

  const connect = async () => {
    const pending = await service.startConnect({
      churchId: "church-1",
      userId: "admin-1",
      returnTo: "/account/integrations",
    });
    const state = new URL(pending.authorizeUrl).searchParams.get("state");
    await service.completeConnect({ state, code: "authorization-code" });
    return pending;
  };
  const pending = await connect();
  return { service, pending, calls, httpClient, connect };
};

test("Planning Center date discovery returns actual related service times", async () => {
  const planEntry = {
    type: "Plan",
    id: "date-plan",
    attributes: {
      dates: "Sunday",
      title: "Worship",
      updated_at: "2026-10-31T12:00:00Z",
      sort_date: "2026-11-01T13:00:00Z",
      items_count: 4,
    },
    relationships: {
      plan_times: {
        data: [
          { type: "PlanTime", id: "service-time" },
          { type: "PlanTime", id: "rehearsal-time" },
        ],
      },
    },
  };
  const included = [
    {
      type: "PlanTime",
      id: "service-time",
      attributes: { starts_at: "2026-11-01T14:00:00Z", time_type: "Service" },
    },
    {
      type: "PlanTime",
      id: "rehearsal-time",
      attributes: { starts_at: "2026-11-01T13:00:00Z", time_type: "Rehearsal" },
    },
  ];
  const { service, calls } = await createConnectedService({
    getHandler: async (url) => String(url).endsWith("/service_types/7/plans")
      ? { data: { data: [planEntry], included } }
      : undefined,
  });

  const result = await service.listPlans({
    churchId: "church-1",
    serviceTypeId: "7",
    filter: "date",
    date: "2026-11-01",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "date-plan");
  assert.equal(result.items[0].updatedAt, "2026-10-31T12:00:00Z");
  assert.deepEqual(result.items[0].serviceTimes, [
    { startsAt: "2026-11-01T14:00:00Z", timeType: "service" },
    { startsAt: "2026-11-01T13:00:00Z", timeType: "rehearsal" },
  ]);
  const listCalls = calls.filter((call) => call.url.endsWith("/service_types/7/plans"));
  assert.equal(listCalls.length, 1);
  assert.deepEqual(listCalls.map(({ params }) => params.filter), ["after"]);
  assert.equal(listCalls[0].params.after, "2026-10-31T00:00:00.000Z");
  assert.equal(listCalls[0].params.order, "sort_date");
  assert.ok(listCalls.every(({ params }) => params.include === "plan_times"));
});

test("Planning Center date discovery rejects malformed dates", async () => {
  const { service, calls } = await createConnectedService();
  await assert.rejects(
    () => service.listPlans({
      churchId: "church-1",
      serviceTypeId: "7",
      filter: "date",
      date: "2026-02-30",
    }),
    /valid service date/,
  );
  assert.equal(
    calls.some((call) => call.url.includes("/service_types/7/plans")),
    false,
  );
});

test("Planning Center date discovery bounds an ascending query to the target date window", async () => {
  const plan = (id, sortDate) => ({
    type: "Plan",
    id,
    attributes: { dates: "Old Sunday", title: id, sort_date: sortDate },
    relationships: { plan_times: { data: [] } },
  });
  const { service, calls } = await createConnectedService({
    getHandler: async (_url, config) => ({ data: { data: [
      plan("target-day", "2020-01-01T12:00:00Z"),
      plan("outside-window", "2020-01-04T12:00:00Z"),
    ] } }),
  });

  const result = await service.listPlans({
    churchId: "church-1",
    serviceTypeId: "7",
    filter: "date",
    date: "2020-01-01",
  });

  assert.deepEqual(result.items.map(({ id }) => id), ["target-day"]);
  const requests = calls
    .filter((call) => call.url.endsWith("/service_types/7/plans"))
    .map(({ params }) => params);
  assert.deepEqual(requests.map(({ filter }) => filter), ["after"]);
  assert.equal(requests[0].after, "2019-12-31T00:00:00.000Z");
  assert.equal(requests[0].order, "sort_date");
});

test("Planning Center date discovery stops paging after the ascending results pass the window", async () => {
  const { service, calls } = await createConnectedService({
    getHandler: async () => ({
      data: {
        data: Array.from({ length: 100 }, (_, index) => ({
          type: "Plan",
          id: `window-plan-${index}`,
          attributes: {
            sort_date: index === 99
              ? "2020-01-04T00:00:00Z"
              : "2020-01-02T00:00:00Z",
          },
        })),
      },
    }),
  });

  const result = await service.listPlans({
    churchId: "church-1",
    serviceTypeId: "7",
    filter: "date",
    date: "2020-01-01",
  });

  assert.equal(result.items.length, 99);
  const planCalls = calls.filter((call) => call.url.endsWith("/service_types/7/plans"));
  assert.equal(planCalls.length, 1);
  assert.equal(planCalls[0].params.offset, 0);
});

test("Planning Center date discovery rejects a full truncated window instead of returning no match", async () => {
  const { service, calls } = await createConnectedService({
    getHandler: async (_url, config) => ({
      data: {
        data: Array.from({ length: 100 }, (_, index) => ({
          type: "Plan",
          id: `window-plan-${config.params.offset}-${index}`,
          attributes: { sort_date: "2020-01-01T12:00:00Z" },
        })),
      },
    }),
  });

  await assert.rejects(
    () => service.listPlans({
      churchId: "church-1",
      serviceTypeId: "7",
      filter: "date",
      date: "2020-01-01",
    }),
    (error) => error.statusCode === 502 && /too many plans to check this date safely/i.test(error.message),
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/service_types/7/plans")).length,
    20,
  );
});

test("Planning Center date discovery rejects undated API rows instead of silently dropping them", async () => {
  const { service } = await createConnectedService({
    getHandler: async () => ({
      data: {
        data: [{
          type: "Plan",
          id: "undated-plan",
          attributes: { sort_date: "unknown" },
        }],
      },
    }),
  });

  await assert.rejects(
    () => service.listPlans({
      churchId: "church-1",
      serviceTypeId: "7",
      filter: "date",
      date: "2020-01-01",
    }),
    (error) => error.statusCode === 502 && /without a valid service date/i.test(error.message),
  );
});

test("Planning Center connect uses PKCE and records a church-scoped connection", async () => {
  const { service, pending } = await createConnectedService();
  const authorizeUrl = new URL(pending.authorizeUrl);
  assert.equal(authorizeUrl.origin, "https://api.planningcenteronline.com");
  assert.equal(authorizeUrl.pathname, "/oauth/authorize");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizeUrl.searchParams.get("scope"), "people services");
  assert.equal(
    authorizeUrl.searchParams.get("redirect_uri"),
    "https://worshipsync.test/api/planning-center/oauth/callback",
  );

  const status = await service.getStatusForChurch({ churchId: "church-1" });
  assert.equal(status.connected, true);
  assert.equal(status.accountLabel, "Example Church");
  assert.equal(status.accountId, "org-123");
  assert.ok(status.connectionRevision);
  assert.equal(status.oauthConfigured, true);

  const connectStatus = await service.getConnectStatus({
    churchId: "church-1",
    connectRequestId: pending.connectRequestId,
    connectRequestSecret: pending.connectRequestSecret,
  });
  assert.equal(connectStatus.status, "completed");
  assert.equal(connectStatus.accountId, "org-123");
  assert.equal(connectStatus.connectionRevision, status.connectionRevision);
});

test("Planning Center connections distinguish organizations with the same label", async () => {
  const { service, connect } = await createConnectedService({
    userInfoResponses: [
      { organization_name: "Shared Church", organization_id: "org-a" },
      { organization_name: "Shared Church", organization_id: "org-b" },
    ],
  });
  const first = await service.getStatusForChurch({ churchId: "church-1" });
  const secondPending = await connect();
  const second = await service.getStatusForChurch({ churchId: "church-1" });
  const secondConnectStatus = await service.getConnectStatus({
    churchId: "church-1",
    connectRequestId: secondPending.connectRequestId,
    connectRequestSecret: secondPending.connectRequestSecret,
  });

  assert.equal(first.accountLabel, second.accountLabel);
  assert.equal(first.accountId, "org-a");
  assert.equal(second.accountId, "org-b");
  assert.notEqual(first.connectionRevision, second.connectionRevision);
  assert.equal(secondConnectStatus.connectionRevision, second.connectionRevision);
});

test("a successful reconnect gets a new revision when both profile lookups fail", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { service, connect } = await createConnectedService({
      userInfoResponses: [
        new Error("profile unavailable"),
        new Error("profile unavailable"),
      ],
    });
    const first = await service.getStatusForChurch({ churchId: "church-1" });
    const secondPending = await connect();
    const second = await service.getStatusForChurch({ churchId: "church-1" });
    const secondConnectStatus = await service.getConnectStatus({
      churchId: "church-1",
      connectRequestId: secondPending.connectRequestId,
      connectRequestSecret: secondPending.connectRequestSecret,
    });

    assert.equal(first.accountLabel, "Connected Planning Center account");
    assert.equal(second.accountLabel, first.accountLabel);
    assert.equal(first.accountId, "");
    assert.equal(second.accountId, "");
    assert.ok(first.connectionRevision);
    assert.notEqual(first.connectionRevision, second.connectionRevision);
    assert.equal(secondConnectStatus.connectionRevision, second.connectionRevision);
  } finally {
    console.warn = originalWarn;
  }
});

test("normal token refresh preserves the Planning Center account revision", async () => {
  let currentTime = Date.parse("2026-11-01T12:00:00.000Z");
  const { service, calls } = await createConnectedService({
    now: () => currentTime,
    getHandler: async (url) => url.endsWith("/services/v2/service_types")
      ? { data: { data: [] } }
      : null,
  });
  const before = await service.getStatusForChurch({ churchId: "church-1" });
  currentTime += 7_200_000;

  await service.listServiceTypes({ churchId: "church-1" });

  const after = await service.getStatusForChurch({ churchId: "church-1" });
  const tokenGrantTypes = calls
    .filter((call) => call.method === "post" && call.url.endsWith("/oauth/token"))
    .map((call) => new URLSearchParams(call.body).get("grant_type"));
  assert.equal(after.accountId, before.accountId);
  assert.equal(after.connectionRevision, before.connectionRevision);
  assert.deepEqual(tokenGrantTypes, ["authorization_code", "refresh_token"]);
});

test("Planning Center disconnect revokes the refresh token and clears status", async () => {
  const { service, calls } = await createConnectedService();
  await service.disconnect({ churchId: "church-1" });

  assert.equal(
    calls.some(
      (call) => call.method === "post" && call.url.endsWith("/oauth/revoke"),
    ),
    true,
  );
  const status = await service.getStatusForChurch({ churchId: "church-1" });
  assert.equal(status.connected, false);
  assert.equal(status.connectionRevision, "");
});

test("Planning Center getPlanImport maps items into import sections", async () => {
  const httpClient = {
    async post(url) {
      if (String(url).endsWith("/oauth/token")) {
        return {
          data: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 7200,
          },
        };
      }
      throw new Error(`Unexpected POST ${url}`);
    },
    async get(url) {
      if (String(url).endsWith("/oauth/userinfo")) {
        return { data: { organization_name: "Example Church" } };
      }
      if (String(url).includes("/service_types/7/plans/42/items")) {
        return {
          data: {
            data: [
              {
                type: "Item",
                id: "1",
                attributes: { item_type: "header", title: "Worship" },
              },
              {
                type: "Item",
                id: "2",
                attributes: { item_type: "song", title: "Song", length: 180 },
                relationships: {
                  song: { data: { type: "Song", id: "s1" } },
                },
              },
            ],
            included: [
              {
                type: "Song",
                id: "s1",
                attributes: { title: "Great Are You Lord" },
              },
            ],
          },
        };
      }
      if (String(url).includes("/service_types/7/plans/42")) {
        return {
          data: {
            data: {
              type: "Plan",
              id: "42",
              attributes: {
                dates: "Sep 14",
                title: "Sunday",
                planning_center_url:
                  "https://services.planningcenteronline.com/plans/42",
              },
              relationships: {
                service_type: { data: { type: "ServiceType", id: "7" } },
              },
            },
          },
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    },
  };

  const service = createPlanningCenterService({
    getFirestore: () => null,
    getRealtimeDatabase: () => null,
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    redirectBaseUrl: "https://worshipsync.test",
    httpClient,
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenEncryptionKey: "a-test-encryption-secret-that-is-not-checked-in",
  });
  const pending = await service.startConnect({
    churchId: "church-1",
    userId: "admin-1",
  });
  const state = new URL(pending.authorizeUrl).searchParams.get("state");
  await service.completeConnect({ state, code: "authorization-code" });

  const imported = await service.getPlanImport({
    churchId: "church-1",
    serviceTypeId: "7",
    planId: "42",
  });
  assert.equal(imported.planId, "42");
  assert.equal(imported.sections[0].sectionName, "Worship");
  assert.equal(imported.sections[0].rows[0].songTitle, "Great Are You Lord");
  assert.equal(imported.sections[0].rows[0].durationMinutes, 3);
});

test("Planning Center connect status rejects mismatched secrets", async () => {
  const { service, pending } = await createConnectedService();
  await assert.rejects(
    () =>
      service.getConnectStatus({
        churchId: "church-1",
        connectRequestId: pending.connectRequestId,
        connectRequestSecret: "wrong-secret",
      }),
    /not available/,
  );
});
