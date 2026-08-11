import { serverDate, serverNow, setServerTimeOffset } from "./serverTime";

describe("serverTime", () => {
  afterEach(() => {
    setServerTimeOffset(0);
    jest.useRealTimers();
  });

  it("serverNow matches Date.now when offset is zero", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T12:00:00.000Z"));
    setServerTimeOffset(0);

    expect(serverNow()).toBe(new Date("2026-05-17T12:00:00.000Z").getTime());
  });

  it("applies a positive offset to serverNow and serverDate", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T12:00:00.000Z"));
    setServerTimeOffset(45_000);

    expect(serverNow()).toBe(new Date("2026-05-17T12:00:45.000Z").getTime());
    expect(serverDate().toISOString()).toBe("2026-05-17T12:00:45.000Z");
  });

  it("applies a negative offset to serverNow", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T12:00:00.000Z"));
    setServerTimeOffset(-12_500);

    expect(serverNow()).toBe(new Date("2026-05-17T11:59:47.500Z").getTime());
  });

  it("replaces the previous offset when set again", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T12:00:00.000Z"));
    setServerTimeOffset(10_000);
    setServerTimeOffset(1_000);

    expect(serverNow()).toBe(new Date("2026-05-17T12:00:01.000Z").getTime());
  });
});
