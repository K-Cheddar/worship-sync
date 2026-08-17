import { act, render, screen } from "@testing-library/react";
import { useScreenOverrides } from "./useScreenOverrides";
import { writeScreenSettings } from "../utils/screenSettingsStore";

const Probe = ({
  outputId,
  paired,
}: {
  outputId: string;
  paired?: Record<string, unknown> | null;
}) => {
  const overrides = useScreenOverrides(outputId, paired);
  return <div data-testid="probe">{JSON.stringify(overrides ?? null)}</div>;
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("useScreenOverrides", () => {
  it("picks up a change made while a display is open, without a reload", () => {
    render(<Probe outputId="out_lobby" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("null");

    act(() => {
      writeScreenSettings("out_lobby", { isHeadless: true });
    });

    expect(screen.getByTestId("probe")).toHaveTextContent('"isHeadless":true');
  });

  it("ignores a change aimed at a different display", () => {
    writeScreenSettings("out_lobby", { isHeadless: true });
    render(<Probe outputId="out_stage" />);

    act(() => {
      writeScreenSettings("out_lobby", { isHeadless: false });
    });

    expect(screen.getByTestId("probe")).toHaveTextContent("null");
  });

  it("lets the paired device's server settings win over the local value", () => {
    writeScreenSettings("out_lobby", { isHeadless: true });
    render(<Probe outputId="out_lobby" paired={{ isHeadless: false }} />);

    expect(screen.getByTestId("probe")).toHaveTextContent('"isHeadless":false');
  });
});

describe("stability", () => {
  it("keeps the same object when a write changes nothing for this display", () => {
    writeScreenSettings("out_lobby", { isHeadless: true });
    const seen: unknown[] = [];

    const Recorder = () => {
      const overrides = useScreenOverrides("out_lobby");
      seen.push(overrides);
      return null;
    };

    render(<Recorder />);
    const before = seen.length;

    act(() => {
      // Same value written again: nothing about this display changed.
      writeScreenSettings("out_lobby", { isHeadless: true });
    });

    // No extra render, so a live display is not re-rendered for a no-op.
    expect(seen.length).toBe(before);
  });

  it("survives a caller that rebuilds its paired settings object each render", () => {
    const Unstable = () => {
      const overrides = useScreenOverrides("out_lobby", { isHeadless: false });
      return <div data-testid="probe">{JSON.stringify(overrides ?? null)}</div>;
    };

    render(<Unstable />);

    expect(screen.getByTestId("probe")).toHaveTextContent('"isHeadless":false');
  });
});
