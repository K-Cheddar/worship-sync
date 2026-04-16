import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "./nextServiceTimer";

describe("nextServiceTimer constants", () => {
  it("defines the upcoming refresh grace window", () => {
    expect(NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS).toBe(15 * 60 * 1000);
  });
});
