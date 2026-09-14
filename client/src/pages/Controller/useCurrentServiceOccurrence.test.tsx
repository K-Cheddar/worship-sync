import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import type { TeamService } from "../../api/authTypes";
import {
  useCurrentServiceOccurrence,
  type CurrentServiceOccurrence,
} from "./useCurrentServiceOccurrence";
import { setServerTimeOffset } from "../../utils/serverTime";

const service = (serviceId: string, dateTimeISO: string): TeamService => ({
  id: serviceId,
  serviceId,
  churchId: "church-1",
  name: serviceId,
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO,
});

const morning = service("morning", "2026-07-26T10:00:00.000Z");
const afternoon = service("afternoon", "2026-07-26T14:00:00.000Z");
const nextDayMorning = service("next-day", "2026-07-27T10:00:00.000Z");
const latePrevious = service(
  "late-previous",
  new Date(2026, 6, 26, 22, 0).toISOString(),
);
const midnightNext = service(
  "midnight-next",
  new Date(2026, 6, 27, 0, 0).toISOString(),
);

let latestResult: CurrentServiceOccurrence | null = null;
let harnessPasses = 0;

const Harness = ({ services }: { services: TeamService[] }) => {
  harnessPasses += 1;
  latestResult = useCurrentServiceOccurrence(services);
  return null;
};

const renderAt = (isoTime: string, services: TeamService[]) => {
  jest.spyOn(Date, "now").mockReturnValue(Date.parse(isoTime));
  return render(<Harness services={services} />);
};

describe("useCurrentServiceOccurrence", () => {
  beforeEach(() => {
    harnessPasses = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    act(() => setServerTimeOffset(0));
    latestResult = null;
  });

  it("picks the service in progress when the page loads", () => {
    renderAt("2026-07-26T12:00:00.000Z", [morning, afternoon]);

    expect(latestResult?.occurrence?.serviceId).toBe("morning");
  });

  it("uses the server-adjusted clock for the initial automatic selection", () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-07-26T12:00:00.000Z"));
    setServerTimeOffset(2 * 60 * 60_000);

    render(<Harness services={[morning, afternoon]} />);

    expect(latestResult?.occurrence?.serviceId).toBe("afternoon");
  });

  it("refreshes automatic selection when a server offset crosses midnight", () => {
    const nowMs = new Date(2026, 6, 26, 23, 59, 59, 500).getTime();
    jest.spyOn(Date, "now").mockReturnValue(nowMs);

    render(<Harness services={[latePrevious, midnightNext]} />);
    expect(latestResult?.occurrence?.serviceId).toBe("late-previous");

    act(() => setServerTimeOffset(500));

    expect(latestResult?.occurrence?.serviceId).toBe("midnight-next");
  });

  // Switching under the operator mid-service is the bug this hook exists to
  // prevent: the pick is made at load and held until they change it.
  it("holds the loaded service even once the next one is closer", () => {
    const { rerender } = renderAt("2026-07-26T12:00:00.000Z", [
      morning,
      afternoon,
    ]);

    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-26T14:30:00.000Z"));
    rerender(<Harness services={[morning, afternoon]} />);

    expect(latestResult?.occurrence?.serviceId).toBe("morning");
  });

  it("keeps the automatic service pinned after a same-day long resume", () => {
    let nowMs = Date.parse("2026-07-26T12:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const setVisibility = (visibility: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
    };

    render(<Harness services={[morning, afternoon]} />);
    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      nowMs += 10_001;
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(latestResult?.occurrence?.serviceId).toBe("morning");
  });

  it("recalculates the automatic service after resuming on a new calendar day", () => {
    let nowMs = Date.parse("2026-07-26T12:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const setVisibility = (visibility: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
    };

    render(<Harness services={[morning, afternoon, nextDayMorning]} />);
    expect(latestResult?.occurrence?.serviceId).toBe("morning");

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      nowMs = Date.parse("2026-07-27T12:00:00.000Z");
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(latestResult?.occurrence?.serviceId).toBe("next-day");
  });

  it("refreshes the automatic selection at the server date boundary", () => {
    jest.useFakeTimers();
    let nowMs = new Date(2026, 6, 26, 23, 59, 59, 500).getTime();
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);

    render(<Harness services={[latePrevious, midnightNext]} />);
    expect(latestResult?.occurrence?.serviceId).toBe("late-previous");

    act(() => {
      nowMs += 500;
      jest.advanceTimersByTime(500);
    });

    expect(latestResult?.occurrence?.serviceId).toBe("midnight-next");
  });

  it("preserves an explicit occurrence selection across the server date boundary", () => {
    jest.useFakeTimers();
    let nowMs = new Date(2026, 6, 26, 23, 59, 59, 500).getTime();
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);

    render(<Harness services={[latePrevious, midnightNext]} />);
    const previousOccurrence = latestResult?.occurrences.find(
      (candidate) => candidate.serviceId === "late-previous",
    );
    act(() => {
      latestResult?.selectOccurrence(previousOccurrence?.occurrenceId || "");
      nowMs += 500;
      jest.advanceTimersByTime(500);
    });

    expect(latestResult?.selectedOccurrenceId).toBe(
      previousOccurrence?.occurrenceId,
    );
    expect(latestResult?.occurrence?.serviceId).toBe("late-previous");
  });

  it("switches when the operator picks another service", () => {
    renderAt("2026-07-26T12:00:00.000Z", [morning, afternoon]);
    const afternoonOccurrence = latestResult?.occurrences.find(
      (candidate) => candidate.serviceId === "afternoon",
    );

    act(() => {
      latestResult?.selectOccurrence(afternoonOccurrence?.occurrenceId || "");
    });

    expect(latestResult?.occurrence?.serviceId).toBe("afternoon");
    expect(latestResult?.selectedOccurrenceId).toBe(
      afternoonOccurrence?.occurrenceId,
    );
  });

  it("preserves a manual occurrence selection across an ordinary resume", () => {
    let nowMs = Date.parse("2026-07-26T12:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const setVisibility = (visibility: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
    };
    render(<Harness services={[morning, afternoon]} />);
    const afternoonOccurrence = latestResult?.occurrences.find(
      (candidate) => candidate.serviceId === "afternoon",
    );
    act(() => {
      latestResult?.selectOccurrence(afternoonOccurrence?.occurrenceId || "");
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      nowMs += 10_001;
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(latestResult?.occurrence?.serviceId).toBe("afternoon");
    expect(latestResult?.selectedOccurrenceId).toBe(
      afternoonOccurrence?.occurrenceId,
    );
  });

  it("drops a manual occurrence selection only after it leaves the schedule", () => {
    let nowMs = Date.parse("2026-07-26T12:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const setVisibility = (visibility: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
    };
    const { rerender } = render(<Harness services={[morning, afternoon]} />);
    const afternoonOccurrence = latestResult?.occurrences.find(
      (candidate) => candidate.serviceId === "afternoon",
    );
    act(() => {
      latestResult?.selectOccurrence(afternoonOccurrence?.occurrenceId || "");
    });
    rerender(<Harness services={[morning]} />);
    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      nowMs = Date.parse("2026-07-27T12:00:00.000Z");
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(latestResult?.selectedOccurrenceId).toBeNull();
    expect(latestResult?.occurrence?.serviceId).toBe("morning");
  });

  it("re-picks when the loaded service leaves the schedule", () => {
    const { rerender } = renderAt("2026-07-26T12:00:00.000Z", [
      morning,
      afternoon,
    ]);
    expect(latestResult?.occurrence?.serviceId).toBe("morning");

    rerender(<Harness services={[afternoon]} />);

    expect(latestResult?.occurrence?.serviceId).toBe("afternoon");
  });

  // The pick used to be held in a ref that render read directly, so which
  // service came back depended on when React chose to evaluate the memo. It is
  // state now: double-invoked render has to reach the same answer and settle.
  it("resolves to the same service under StrictMode double rendering", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-26T12:00:00.000Z"));
    const { rerender } = render(
      <StrictMode>
        <Harness services={[morning, afternoon]} />
      </StrictMode>,
    );
    expect(latestResult?.occurrence?.serviceId).toBe("morning");

    // A fresh array with the same content, as a background poll produces.
    const passesBeforeUpdate = harnessPasses;
    rerender(
      <StrictMode>
        <Harness services={[{ ...morning }, { ...afternoon }]} />
      </StrictMode>,
    );

    expect(latestResult?.occurrence?.serviceId).toBe("morning");
    // Re-picking must not chase its own state update round after round.
    expect(harnessPasses - passesBeforeUpdate).toBeLessThanOrEqual(4);
  });

  it("has nothing to show without services", () => {
    renderAt("2026-07-26T12:00:00.000Z", []);

    expect(latestResult?.occurrence).toBeNull();
    expect(latestResult?.occurrences).toEqual([]);
  });
});
