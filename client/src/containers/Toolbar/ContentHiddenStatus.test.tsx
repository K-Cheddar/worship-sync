import { render, screen } from "@testing-library/react";
import { GlobalInfoContext } from "../../context/globalInfo";
import ContentHiddenStatus from "./ContentHiddenStatus";
import type { ControllerProfile } from "../../utils/controllerProfiles";

const mockState = {
  displayOutputs: {
    list: [
      { id: "stream-a", type: "stream", name: "Lobby", enabled: true },
      { id: "stream-b", type: "stream", name: "Sanctuary", enabled: true },
    ],
  },
  presentation: {
    outputs: {
      "stream-a": { id: "stream-a", type: "stream", itemContentBlocked: false, isTransmitting: true },
      "stream-b": { id: "stream-b", type: "stream", itemContentBlocked: true, isTransmitting: true },
    },
  },
  undoable: {
    present: {
      preferences: { preferences: { overlayTargetOutputIds: ["stream-b"] } },
    },
  },
};

let mockProfile: ControllerProfile = {
  id: "presentation",
  type: "presentation",
  name: "Presentation",
  description: "",
  order: 0,
  enabled: true,
  outputIds: ["stream-a"],
  outputsConfigured: true,
  defaultSendOutputIds: [],
  outlineScope: "presentation",
};

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

jest.mock("../../context/activeController", () => ({
  useActiveControllerProfile: () => mockProfile,
}));

const renderStatus = () =>
  render(
    <GlobalInfoContext.Provider
      value={{ sharedDataReady: true, realtimeConnected: true } as never}
    >
      <ContentHiddenStatus />
    </GlobalInfoContext.Provider>,
  );

describe("ContentHiddenStatus", () => {
  it("only reports hidden content for a stream the presentation controller owns", () => {
    mockProfile = { ...mockProfile, type: "presentation", outputIds: ["stream-a"] };
    renderStatus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    mockState.presentation.outputs["stream-a"].itemContentBlocked = true;
    renderStatus();
    expect(screen.getByRole("status", { name: "Content Hidden on Lobby" })).toBeInTheDocument();
  });

  it("identifies multiple affected streams for overlay and presentation controllers", () => {
    mockProfile = {
      ...mockProfile,
      type: "presentation",
      outputIds: ["stream-a", "stream-b"],
    };
    mockState.presentation.outputs["stream-a"].itemContentBlocked = true;
    const { unmount } = renderStatus();
    expect(screen.getByRole("status", { name: "Content Hidden on Lobby, Sanctuary" })).toBeInTheDocument();
    unmount();

    mockProfile = { ...mockProfile, type: "overlay", outputIds: ["stream-b"] };
    mockState.presentation.outputs["stream-b"].itemContentBlocked = true;
    renderStatus();
    expect(screen.getByRole("status", { name: "Content Hidden on Sanctuary" })).toBeInTheDocument();
    mockProfile = {
      ...mockProfile,
      type: "aux-presentation",
      outputIds: ["stream-a"],
    };
    mockState.presentation.outputs["stream-a"].itemContentBlocked = true;
    renderStatus();
    expect(screen.getByRole("status", { name: "Content Hidden on Lobby" })).toBeInTheDocument();
  });

  it("does not confirm a stale local status while Firebase is disconnected", () => {
    mockProfile = { ...mockProfile, type: "presentation", outputIds: ["stream-b"] };
    render(
      <GlobalInfoContext.Provider
        value={{ sharedDataReady: true, realtimeConnected: false } as never}
      >
        <ContentHiddenStatus />
      </GlobalInfoContext.Provider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
