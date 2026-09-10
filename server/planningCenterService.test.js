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

const createConnectedService = async () => {
  const calls = [];
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
    async get(url) {
      calls.push({ method: "get", url });
      if (url.endsWith("/oauth/userinfo")) {
        return {
          data: {
            name: "Jordan Admin",
            organization_name: "Example Church",
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
    returnTo: "/account/integrations",
  });
  const state = new URL(pending.authorizeUrl).searchParams.get("state");
  await service.completeConnect({ state, code: "authorization-code" });
  return { service, pending, calls, httpClient };
};

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
  assert.equal(status.oauthConfigured, true);

  const connectStatus = await service.getConnectStatus({
    churchId: "church-1",
    connectRequestId: pending.connectRequestId,
    connectRequestSecret: pending.connectRequestSecret,
  });
  assert.equal(connectStatus.status, "completed");
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
