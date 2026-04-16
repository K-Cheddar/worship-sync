import test from "node:test";
import assert from "node:assert/strict";

const { authHandlers } = await import("../authService.js");

const createReq = ({
  params = {},
  headers = {},
  session = {},
  body = {},
} = {}) => ({
  params,
  headers,
  session,
  body,
});

const createRes = () => {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  return res;
};

test("revokeChurchInvite requires an authenticated admin session", async () => {
  const res = createRes();
  await authHandlers.revokeChurchInvite(
    createReq({
      params: { churchId: "church_test", inviteId: "invite_test" },
      headers: {},
      session: {},
    }),
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.success, false);
});
