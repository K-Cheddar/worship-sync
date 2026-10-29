import {
  beginActiveControllerPresence,
  getControllerPresenceScope,
  isOnlyActiveController,
} from "./activeControllerPresence";

describe("active Controller presence inventory", () => {
  it("allows cleanup only when a complete inventory shows this as the sole Controller", () => {
    const scope = getControllerPresenceScope("church-1", "content-db");
    const presence = beginActiveControllerPresence(scope);

    expect(isOnlyActiveController(scope, "host-1")).toBe(false);
    presence.publish(["host-1"]);
    expect(isOnlyActiveController(scope, "host-1")).toBe(true);
    expect(isOnlyActiveController(scope, "host-2")).toBe(false);

    presence.publish(["host-1", "host-2"]);
    expect(isOnlyActiveController(scope, "host-1")).toBe(false);
    presence.publish(null);
    expect(isOnlyActiveController(scope, "host-1")).toBe(false);
    presence.release();
  });

  it("prevents a stale tracker from replacing a newer inventory", () => {
    const scope = getControllerPresenceScope("church-1", "content-db");
    const stalePresence = beginActiveControllerPresence(scope);
    const currentPresence = beginActiveControllerPresence(scope);

    stalePresence.publish(["host-1"]);
    expect(isOnlyActiveController(scope, "host-1")).toBe(false);
    currentPresence.publish(["host-2"]);
    expect(isOnlyActiveController(scope, "host-2")).toBe(true);
    stalePresence.release();
    expect(isOnlyActiveController(scope, "host-2")).toBe(true);
    currentPresence.release();
  });
});
