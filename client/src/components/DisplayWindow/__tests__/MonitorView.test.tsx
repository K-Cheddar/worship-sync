import { render, screen } from "@testing-library/react";
import type { Box } from "../../../types";
import MonitorView from "../MonitorView";

jest.mock("../DisplayBox", () => ({
  __esModule: true,
  default: ({
    box,
    isPrev,
  }: {
    box: Box;
    isPrev?: boolean;
  }) => (
    <div
      data-testid={isPrev ? "monitor-prev-box" : "monitor-current-box"}
      data-box-id={box.id}
      data-words={box.words ?? ""}
    />
  ),
}));

jest.mock("../HLSVideoPlayer", () => ({
  __esModule: true,
  default: () => <div data-testid="monitor-hls-player" />,
}));

jest.mock("../DisplayClock", () => ({
  __esModule: true,
  default: () => <div data-testid="monitor-clock" />,
}));

jest.mock("../DisplayTimer", () => ({
  __esModule: true,
  default: () => <div data-testid="monitor-timer" />,
}));

jest.mock("../VerseDisplay", () => ({
  __esModule: true,
  default: ({ words }: { words: string }) => <div>{words}</div>,
}));

const baseBox: Box = {
  id: "shared-box",
  words: "Current words",
  width: 100,
  height: 100,
  fontSize: 40,
  brightness: 100,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "",
  fontColor: "#fff",
  shouldKeepAspectRatio: false,
  transparent: false,
  excludeFromOverflow: false,
  align: "center",
  slideIndex: 0,
  label: "Main",
  isBold: false,
  isItalic: false,
};

describe("MonitorView", () => {
  it("does not warn about duplicate keys when current and previous single-slide boxes reuse the same id", () => {
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <MonitorView
        boxes={[baseBox]}
        prevBoxes={[{ ...baseBox, words: "Previous words" }]}
        nextBoxes={[]}
        prevNextBoxes={[]}
        showBackground={false}
        shouldAnimate
        effectiveWidth={50}
        scaleFactor={1}
        effectiveShowClock={false}
        effectiveShowTimer={false}
        clockFontSize={16}
        timerFontSize={16}
      />,
    );

    expect(screen.getByTestId("monitor-current-box")).toHaveAttribute(
      "data-words",
      "Current words",
    );
    expect(screen.getByTestId("monitor-prev-box")).toHaveAttribute(
      "data-words",
      "Previous words",
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Encountered two children with the same key"),
    );

    consoleErrorSpy.mockRestore();
  });
});
