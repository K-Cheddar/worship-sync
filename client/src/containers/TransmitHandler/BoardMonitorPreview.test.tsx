import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BoardMonitorPreview from "./BoardMonitorPreview";
import { setMonitorBoardAliasId } from "../../store/presentationSlice";

const mockState = {
  presentation: {
    monitorBoardAliasId: "",
  },
};

let scaledBoardPreviewProps: { aliasId: string } | null = null;
let storedAliasId = "local-board";
const dispatch = jest.fn();
const changeFontScale = jest.fn();
// Records how BoardMonitorPreview drives the font-scale hook (which alias it
// targets and whether it's enabled) so we can assert the wiring without the
// hook's real fetch/EventSource.
const fontScaleHook = jest.fn(
  (_aliasId: string, _options?: { enabled?: boolean }) => ({
    fontScale: 1,
    changeFontScale,
    isReady: true,
  }),
);

jest.mock("../../hooks", () => ({
  useDispatch: () => dispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../boards/useStoredBoardDisplayAlias", () => ({
  useStoredBoardDisplayAlias: () => storedAliasId,
}));

jest.mock("../../boards/useBoardPresentationFontScale", () => ({
  useBoardPresentationFontScale: (
    aliasId: string,
    options?: { enabled?: boolean },
  ) => fontScaleHook(aliasId, options),
}));

jest.mock("../../boards/ScaledBoardPreview", () => ({
  __esModule: true,
  default: (props: { aliasId: string }) => {
    scaledBoardPreviewProps = props;
    return <div data-testid="scaled-board-preview-mock" />;
  },
}));

describe("BoardMonitorPreview", () => {
  beforeEach(() => {
    scaledBoardPreviewProps = null;
    storedAliasId = "local-board";
    dispatch.mockClear();
    changeFontScale.mockClear();
    fontScaleHook.mockClear();
    mockState.presentation.monitorBoardAliasId = "";
  });

  it("mirrors the board that is live on the monitor, even when it differs from the local board", () => {
    mockState.presentation.monitorBoardAliasId = "monitor-board";

    render(<BoardMonitorPreview isOpen />);

    // Preview must show what's actually on the monitor, not the local alias.
    expect(scaledBoardPreviewProps?.aliasId).toBe("monitor-board");
  });

  it("previews the local board to put up when nothing is on the monitor", () => {
    mockState.presentation.monitorBoardAliasId = "";

    render(<BoardMonitorPreview isOpen />);

    expect(scaledBoardPreviewProps?.aliasId).toBe("local-board");
  });

  it("opens no board connection while collapsed", () => {
    mockState.presentation.monitorBoardAliasId = "monitor-board";

    render(<BoardMonitorPreview isOpen={false} />);

    expect(scaledBoardPreviewProps?.aliasId).toBe("");
  });

  it("disables the toggle when there is no board to put up and none is live", () => {
    storedAliasId = "";
    mockState.presentation.monitorBoardAliasId = "";

    render(<BoardMonitorPreview isOpen />);

    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("keeps a live board switchable off even after its local alias is cleared", async () => {
    // Regression: the seeded board alias vanished mid-service (deleted/deselected,
    // or a cross-tab storage/focus sync zeroed it) while a board was still live on
    // the monitor. The "off" switch must stay enabled so the board can be removed.
    storedAliasId = "";
    mockState.presentation.monitorBoardAliasId = "monitor-board";

    render(<BoardMonitorPreview isOpen />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeEnabled();

    await userEvent.click(toggle);

    expect(dispatch).toHaveBeenCalledWith(setMonitorBoardAliasId(""));
  });

  it("targets the live monitor board for the font-size control", () => {
    mockState.presentation.monitorBoardAliasId = "monitor-board";

    render(<BoardMonitorPreview isOpen />);

    // Sizing must apply to whatever is actually on the monitor, not the local board.
    expect(fontScaleHook).toHaveBeenCalledWith("monitor-board", {
      enabled: true,
    });
  });

  it("targets the local board and stays idle while collapsed", () => {
    render(<BoardMonitorPreview isOpen={false} />);

    expect(fontScaleHook).toHaveBeenCalledWith("local-board", {
      enabled: false,
    });
  });

  it("adjusts the presentation text size from the control", async () => {
    render(<BoardMonitorPreview isOpen />);

    await userEvent.click(
      screen.getByRole("button", { name: /Increase presentation text size/i }),
    );

    // The control debounces the persist, so wait for the coalesced write.
    await waitFor(() => expect(changeFontScale).toHaveBeenCalledWith(1.1));
  });

  it("disables the font-size control when there is no board to size", () => {
    storedAliasId = "";
    mockState.presentation.monitorBoardAliasId = "";

    render(<BoardMonitorPreview isOpen />);

    expect(
      screen.getByRole("button", { name: /Increase presentation text size/i }),
    ).toBeDisabled();
  });
});
