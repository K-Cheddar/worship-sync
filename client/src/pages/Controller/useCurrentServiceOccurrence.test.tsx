import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import type { TeamService } from "../../api/authTypes";
import {
  useCurrentServiceOccurrence,
  type CurrentServiceOccurrence,
} from "./useCurrentServiceOccurrence";

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
    latestResult = null;
  });

  it("picks the service in progress when the page loads", () => {
    renderAt("2026-07-26T12:00:00.000Z", [morning, afternoon]);

    expect(latestResult?.occurrence?.serviceId).toBe("morning");
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
