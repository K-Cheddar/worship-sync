import {
  NEXT_SERVICE_TIMER_ID,
  getNextServiceTimerId,
} from "./nextServiceTimer";

describe("nextServiceTimer constants", () => {
  it("scopes the synthetic timer id to the current host", () => {
    expect(getNextServiceTimerId("host-a")).toBe("next-service:host-a");
    expect(getNextServiceTimerId("host-b")).toBe("next-service:host-b");
    expect(getNextServiceTimerId("host-a")).not.toBe(
      getNextServiceTimerId("host-b"),
    );
  });

  it("falls back to the legacy id when no host id is available", () => {
    expect(getNextServiceTimerId()).toBe(NEXT_SERVICE_TIMER_ID);
    expect(getNextServiceTimerId("   ")).toBe(NEXT_SERVICE_TIMER_ID);
  });
});
