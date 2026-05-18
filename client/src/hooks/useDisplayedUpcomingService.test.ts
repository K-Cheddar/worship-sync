import { renderHook, act } from "@testing-library/react";
import { useDisplayedUpcomingService } from "./useDisplayedUpcomingService";
import { createServiceTime } from "../test/fixtures";
import type { ServiceTime } from "../types";

const futureIso = (msFromNow: number) =>
  new Date(Date.now() + msFromNow).toISOString();

const pastIso = (msAgo: number) =>
  new Date(Date.now() - msAgo).toISOString();

describe("useDisplayedUpcomingService", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns null when services list is empty", () => {
    const services: ServiceTime[] = [];
    const { result } = renderHook(() =>
      useDisplayedUpcomingService(services, 0),
    );
    expect(result.current).toBeNull();
  });

  it("returns the upcoming one_time service", () => {
    const service = createServiceTime({
      id: "s1",
      name: "Sunday Service",
      reccurence: "one_time",
      dateTimeISO: futureIso(60_000),
    });
    const services = [service];
    const { result } = renderHook(() =>
      useDisplayedUpcomingService(services, 0),
    );
    expect(result.current?.service.id).toBe("s1");
  });

  it("returns null for a one_time service that has already passed (no grace)", () => {
    const service = createServiceTime({
      id: "s1",
      name: "Past Service",
      reccurence: "one_time",
      dateTimeISO: pastIso(5_000),
    });
    const services = [service];
    const { result } = renderHook(() =>
      useDisplayedUpcomingService(services, 0),
    );
    expect(result.current).toBeNull();
  });

  it("returns a recently elapsed service within the grace window", () => {
    const service = createServiceTime({
      id: "s1",
      name: "Grace Service",
      reccurence: "one_time",
      dateTimeISO: pastIso(1_000),
    });
    const services = [service];
    const { result } = renderHook(() =>
      useDisplayedUpcomingService(services, 10_000),
    );
    expect(result.current?.service.id).toBe("s1");
  });

  it("returns null after the grace window expires", () => {
    const graceMs = 5_000;
    const service = createServiceTime({
      id: "s1",
      name: "Grace Service",
      reccurence: "one_time",
      dateTimeISO: pastIso(1_000),
    });
    const services = [service];
    const { result } = renderHook(() =>
      useDisplayedUpcomingService(services, graceMs),
    );
    expect(result.current?.service.id).toBe("s1");

    act(() => {
      jest.advanceTimersByTime(graceMs + 100);
    });
    expect(result.current).toBeNull();
  });

  it("picks the closest service when multiple upcoming services exist", () => {
    const soonService = createServiceTime({
      id: "soon",
      name: "Soon",
      reccurence: "one_time",
      dateTimeISO: futureIso(10_000),
    });
    const laterService = createServiceTime({
      id: "later",
      name: "Later",
      reccurence: "one_time",
      dateTimeISO: futureIso(60_000),
    });
    const services = [laterService, soonService];
    const { result } = renderHook(() =>
      useDisplayedUpcomingService(services, 0),
    );
    expect(result.current?.service.id).toBe("soon");
  });
});
