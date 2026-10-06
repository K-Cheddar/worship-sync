import test from "node:test";
import assert from "node:assert/strict";
import { buildSharedDataWriteClaims } from "./sharedDataAuthClaims.js";

test("shared-data claims preserve Controller None and independent Services Edit", () => {
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "member",
    appAccess: "member",
    controllerAccess: "none",
    permissions: { teams: "none", services: "edit" },
  }), { controllerAccess: "none", servicesAccess: "edit" });
});

test("legacy global Teams edit keeps Services write compatibility", () => {
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "member",
    controllerAccess: "view",
    permissions: { teams: "edit", services: "none" },
  }), { controllerAccess: "view", servicesAccess: "edit" });
});

test("Services access does not elevate Controller claims", () => {
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "member",
    controllerAccess: "none",
    permissions: { teams: "none", services: "edit" },
  }), { controllerAccess: "none", servicesAccess: "edit" });
});
