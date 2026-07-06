import { type ComponentProps } from "react";
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

const renderPreview = (
  props: Partial<ComponentProps<typeof BoardMonitorPreview>> = {},
) =>
  render(
    <BoardMonitorPreview aliasId="local-board" isOpen {...props} />,
  );

describe("BoardMonitorPreview", () => {
  beforeEach(() => {
    scaledBoardPreviewProps = null;
    dispatch.mockClear();
    changeFontScale.mockClear();
    fontScaleHook.mockClear();
    mockState.presentation.monitorBoardAliasId = "";
    localStorage.clear();
  });

  it("mirrors the board that is live on the monitor, even when it differs from the local board", () => {
    mockState.presentation.monitorBoardAliasId = "monitor-board";

    renderPreview();

    // Preview must show what's actually on the monitor, not the local alias.
    expect(scaledBoardPreviewProps?.aliasId).toBe("monitor-board");
  });

  it("previews the resolved board to put up when nothing is on the monitor", () => {
    mockState.presentation.monitorBoardAliasId = "";

    renderPreview();

    expect(scaledBoardPreviewProps?.aliasId).toBe("local-board");
  });

  it("opens no board connection while collapsed", () => {
    mockState.presentation.monitorBoardAliasId = "monitor-board";

    renderPreview({ isOpen: false });

    expect(scaledBoardPreviewProps?.aliasId).toBe("");
  });

  it("sizes the preview to match other transmit-handler displays", () => {
    renderPreview({ previewScale: 1, isMobile: false });

    expect(screen.getByTestId("board-monitor-preview-stage")).toHaveStyle({
      width: "14vw",
    });
  });

  it("places the preview to the left of the monitor controls", () => {
    renderPreview();

    const preview = screen.getByTestId("scaled-board-preview-mock");
    const toggle = screen.getByRole("switch");
    const sizeControl = screen.getByRole("group", {
      name: /Presentation text size/i,
    });
    expect(
      preview.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toggle.compareDocumentPosition(sizeControl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("labels the monitor toggle", () => {
    renderPreview();

    // The switch is labelled by the inline "On monitor" text.
    expect(
      screen.getByRole("switch", { name: /On monitor/i }),
    ).toBeInTheDocument();
  });

  it("disables the toggle when there is no board to put up and none is live", () => {
    mockState.presentation.monitorBoardAliasId = "";

    renderPreview({ aliasId: "" });

    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("keeps a live board switchable off even after its local alias is cleared", async () => {
    // Regression: the seeded board alias vanished mid-service (deleted/deselected,
    // or a cross-tab storage/focus sync zeroed it) while a board was still live on
    // the monitor. The "off" switch must stay enabled so the board can be removed.
    mockState.presentation.monitorBoardAliasId = "monitor-board";

    renderPreview({ aliasId: "" });

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeEnabled();

    await userEvent.click(toggle);

    expect(dispatch).toHaveBeenCalledWith(setMonitorBoardAliasId(""));
  });

  it("remembers the resolved board for this device when turned on", async () => {
    mockState.presentation.monitorBoardAliasId = "";

    renderPreview({ aliasId: "resolved-board" });

    await userEvent.click(screen.getByRole("switch"));

    // Turning it on both puts it on the monitor and seeds this device's storage.
    expect(dispatch).toHaveBeenCalledWith(
      setMonitorBoardAliasId("resolved-board"),
    );
    expect(localStorage.getItem("worshipsyncBoardDisplayAliasId")).toBe(
      "resolved-board",
    );
  });

  it("targets the live monitor board for the font-size control", () => {
    mockState.presentation.monitorBoardAliasId = "monitor-board";

    renderPreview();

    // Sizing must apply to whatever is actually on the monitor, not the local board.
    expect(fontScaleHook).toHaveBeenCalledWith("monitor-board", {
      enabled: true,
    });
  });

  it("targets the resolved board and stays idle while collapsed", () => {
    renderPreview({ isOpen: false });

    expect(fontScaleHook).toHaveBeenCalledWith("local-board", {
      enabled: false,
    });
  });

  it("adjusts the presentation text size from the control", async () => {
    renderPreview();

    await userEvent.click(
      screen.getByRole("button", { name: /Increase presentation text size/i }),
    );

    // The control debounces the persist, so wait for the coalesced write.
    await waitFor(() => expect(changeFontScale).toHaveBeenCalledWith(1.1));
  });

  it("disables the font-size control when there is no board to size", () => {
    mockState.presentation.monitorBoardAliasId = "";

    renderPreview({ aliasId: "" });

    expect(
      screen.getByRole("button", { name: /Increase presentation text size/i }),
    ).toBeDisabled();
  });
});
