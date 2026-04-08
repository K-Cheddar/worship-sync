import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeDisplayDeviceForClient,
  sanitizeInviteForClient,
  sanitizePairingForClient,
  sanitizeWorkstationDeviceForClient,
} from "./authResponseSanitize.js";

test("sanitizeWorkstationDeviceForClient removes credentialHash and tokenHash", () => {
  const out = sanitizeWorkstationDeviceForClient({
    deviceId: "ws_1",
    label: "Desk",
    credentialHash: "deadbeef",
    tokenHash: "should-not-appear",
    churchId: "c1",
  });
  assert.deepEqual(out, {
    deviceId: "ws_1",
    label: "Desk",
    churchId: "c1",
  });
  assert.equal("credentialHash" in out, false);
  assert.equal("tokenHash" in out, false);
});

test("sanitizeDisplayDeviceForClient removes credentialHash", () => {
  const out = sanitizeDisplayDeviceForClient({
    deviceId: "dp_1",
    credentialHash: "abc",
    surfaceType: "display",
  });
  assert.deepEqual(out, { deviceId: "dp_1", surfaceType: "display" });
});

test("sanitizeInviteForClient removes tokenHash but keeps inviteLink", () => {
  const out = sanitizeInviteForClient({
    inviteId: "inv_1",
    tokenHash: "hashed",
    inviteLink: "https://example.com/#/invite?token=x",
  });
  assert.deepEqual(out, {
    inviteId: "inv_1",
    inviteLink: "https://example.com/#/invite?token=x",
  });
});

test("sanitizePairingForClient removes tokenHash; token added separately in handlers", () => {
  const pairing = {
    pairingId: "p1",
    tokenHash: "hashed",
    label: "A",
  };
  const out = { ...sanitizePairingForClient(pairing), token: "plaintext-once" };
  assert.deepEqual(out, {
    pairingId: "p1",
    label: "A",
    token: "plaintext-once",
  });
});

test("sanitize helpers pass through null and non-objects", () => {
  assert.equal(sanitizeWorkstationDeviceForClient(null), null);
  assert.equal(sanitizeInviteForClient(undefined), undefined);
});
