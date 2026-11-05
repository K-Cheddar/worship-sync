import assert from "node:assert/strict";
import test from "node:test";
import {
  assertControllerFirebaseTargetSupported,
  assertControllerIsolationInstalled,
  ControllerFirebaseWriteFirewall,
  isLongPollingWritePacket,
} from "./controllerFirebaseIsolation";

const encodePacket = (action: string, data: unknown = null) => Buffer
  .from(JSON.stringify({ t: "d", d: { r: 1, a: action, b: { p: "/probe", d: data } } }))
  .toString("base64")
  .replace(/=/g, ".")
  .replace(/\+/g, "-")
  .replace(/\//g, "_");

const longPollUrl = (action: string, options: { id?: string; packet?: string; sequence?: number; total?: number } = {}) => {
  const url = new URL("https://example.firebaseio.com/.lp");
  url.searchParams.set("id", options.id ?? "controller-e2e-session");
  url.searchParams.set("ser", "1");
  if (options.packet) {
    url.searchParams.set("seg0", String(options.sequence ?? 0));
    url.searchParams.set("ts0", String(options.total ?? 1));
    url.searchParams.set("d0", options.packet);
  } else {
    url.searchParams.set("seg0", "0");
    url.searchParams.set("ts0", "1");
    url.searchParams.set("d0", encodePacket(action));
  }
  return url.toString();
};

test("keeps RTDB registry reads and long-poll subscriptions available", () => {
  const firewall = new ControllerFirebaseWriteFirewall();
  assert.deepEqual(
    firewall.inspectRequest("GET", "https://example.firebaseio.com/churches/demo/data/controllerProfiles.json?auth=redacted"),
    { action: "allow" },
  );
  assert.deepEqual(firewall.inspectRequest("GET", "https://example.firebasedatabase.app/churches/demo/data/displayOutputs.json"), { action: "allow" });
  assert.deepEqual(firewall.inspectRequest("GET", longPollUrl("q")), { action: "allow" });
  assert.deepEqual(firewall.inspectRequest("GET", longPollUrl("g")), { action: "allow" });
  assert.equal(isLongPollingWritePacket("https://example.firebaseio.com/.lp?id=session&ser=1"), false);
});

test("blocks Firebase REST writes and long-poll writes and onDisconnect commands", () => {
  const firewall = new ControllerFirebaseWriteFirewall();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(
      firewall.inspectRequest(method, "https://example.firebaseio.com/churches/demo/data/presentation.json").action,
      "block",
    );
  }
  for (const action of ["p", "m", "o", "om", "oc"]) {
    const decision = firewall.inspectRequest("GET", longPollUrl(action));
    assert.equal(decision.action, "block", `${action} must not reach Firebase`);
    assert.ok(["long_poll_write", "unknown_long_poll_action"].includes(decision.reason ?? ""));
  }
});

test("blocks continuation segments after the first segment identifies a write", () => {
  const firewall = new ControllerFirebaseWriteFirewall();
  const packet = encodePacket("p", "x".repeat(2_000));
  const first = packet.slice(0, 100);
  const continuation = packet.slice(100);

  assert.equal(firewall.inspectRequest("GET", longPollUrl("", { packet: first, total: 2 })).action, "block");
  assert.equal(
    firewall.inspectRequest("GET", longPollUrl("", { packet: continuation, sequence: 1, total: 2 })).action,
    "block",
  );
});

test("blocks unknown long-poll commands and ignores unrelated CouchDB traffic", () => {
  const firewall = new ControllerFirebaseWriteFirewall();
  assert.deepEqual(
    firewall.inspectRequest("GET", "https://couch.example.net/demo/_bulk_docs"),
    { action: "ignore" },
  );
  assert.equal(firewall.inspectRequest("GET", longPollUrl("unrecognized-action")).action, "block");
});

test("fails closed when the test isolation boundary is incomplete", () => {
  assert.throws(() => assertControllerIsolationInstalled(undefined), /isolation is incomplete/);
  assert.throws(() => assertControllerIsolationInstalled({ networkGuardInstalled: true }), /isolation is incomplete/);
  assert.throws(
    () => assertControllerFirebaseTargetSupported({ networkGuardInstalled: true, sdkWriteBoundaryInstalled: true, longPollingConfigured: true, writeCapabilitiesDisabled: true }),
    /cannot verify the configured Realtime Database target/,
  );
  assert.doesNotThrow(() => assertControllerFirebaseTargetSupported({
    networkGuardInstalled: true,
    sdkWriteBoundaryInstalled: true,
    longPollingConfigured: true,
    writeCapabilitiesDisabled: true,
    databaseUrlSupported: true,
  }));
});
