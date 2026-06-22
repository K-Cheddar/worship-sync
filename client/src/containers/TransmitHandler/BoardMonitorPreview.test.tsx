import { render } from "@testing-library/react";
import BoardMonitorPreview from "./BoardMonitorPreview";

const mockState = {
  presentation: {
    monitorBoardAliasId: "",
  },
};

let scaledBoardPreviewProps: { aliasId: string } | null = null;

jest.mock("../../hooks", () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../boards/useStoredBoardDisplayAlias", () => ({
  useStoredBoardDisplayAlias: () => "local-board",
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
});
