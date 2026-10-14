import test from "node:test";
import assert from "node:assert/strict";
import { buildSharedDataWriteClaims } from "./sharedDataAuthClaims.js";

test("shared-data claims preserve Controller None and independent Services Edit", () => {
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "member",
    appAccess: "member",
    controllerAccess: "none",
    permissions: { teams: "none", services: "edit" },
  }), { sharedDataAuthVersion: 2, controllerAccess: "none", servicesAccess: "edit" });
});

test("global Teams edit does not grant Services write access", () => {
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "member",
    controllerAccess: "view",
    permissions: { teams: "edit", services: "none" },
  }), { sharedDataAuthVersion: 2, controllerAccess: "view", servicesAccess: "none" });
});

test("global Teams view does not grant Services access", () => {
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "member",
    controllerAccess: "music",
    permissions: { teams: "view", services: "none" },
  }), { sharedDataAuthVersion: 2, controllerAccess: "music", servicesAccess: "none" });
});

test("Services Edit and administrators receive Services write access", () => {
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "member",
    permissions: { teams: "none", services: "edit" },
  }), { sharedDataAuthVersion: 2, controllerAccess: "view", servicesAccess: "edit" });
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "admin",
    controllerAccess: "full",
    permissions: { teams: "none", services: "none" },
  }), { sharedDataAuthVersion: 2, controllerAccess: "full", servicesAccess: "edit" });
});

test("Services access does not elevate Controller claims", () => {
  assert.deepEqual(buildSharedDataWriteClaims({
    role: "member",
    controllerAccess: "none",
    permissions: { teams: "none", services: "edit" },
  }), { sharedDataAuthVersion: 2, controllerAccess: "none", servicesAccess: "edit" });
});
