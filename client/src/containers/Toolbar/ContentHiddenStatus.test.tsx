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

const renderStatus = (
  contentHiddenByOutput: Record<string, { hidden: boolean; confirmed: boolean }> = {},
  realtimeConnected = true,
) =>
  render(
    <GlobalInfoContext.Provider
      value={{ contentHiddenByOutput, realtimeConnected } as never}
    >
      <ContentHiddenStatus />
    </GlobalInfoContext.Provider>,
  );

describe("ContentHiddenStatus", () => {
  it("only reports hidden content for a stream the presentation controller owns", () => {
    mockProfile = { ...mockProfile, type: "presentation", outputIds: ["stream-a"] };
    renderStatus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    renderStatus({ "stream-a": { hidden: true, confirmed: true } });
    expect(screen.getByRole("status", { name: "Content Hidden on Lobby" })).toBeInTheDocument();
  });

  it("identifies multiple affected streams for overlay and presentation controllers", () => {
    mockProfile = {
      ...mockProfile,
      type: "presentation",
      outputIds: ["stream-a", "stream-b"],
    };
    const { unmount } = renderStatus({
      "stream-a": { hidden: true, confirmed: true },
      "stream-b": { hidden: true, confirmed: true },
    });
    expect(screen.getByRole("status", { name: "Content Hidden on Lobby, Sanctuary" })).toBeInTheDocument();
    unmount();

    mockProfile = { ...mockProfile, type: "overlay", outputIds: ["stream-b"] };
    renderStatus({ "stream-b": { hidden: true, confirmed: true } });
    expect(screen.getByRole("status", { name: "Content Hidden on Sanctuary" })).toBeInTheDocument();
    mockProfile = {
      ...mockProfile,
      type: "aux-presentation",
      outputIds: ["stream-a"],
    };
    renderStatus({ "stream-a": { hidden: true, confirmed: true } });
    expect(screen.getByRole("status", { name: "Content Hidden on Lobby" })).toBeInTheDocument();
  });

  it("retains the last hidden state while disconnected and labels it unconfirmed", () => {
    mockProfile = { ...mockProfile, type: "presentation", outputIds: ["stream-b"] };
    renderStatus({ "stream-b": { hidden: true, confirmed: false } }, false);
    expect(screen.getByRole("status", { name: /Content Hidden · Offline on Sanctuary/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("border-dashed");
  });

  it("does not report cached Redux values before this controller receives a stream snapshot", () => {
    mockProfile = { ...mockProfile, type: "presentation", outputIds: ["stream-b"] };
    renderStatus({}, false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("returns to confirmed state after synchronization and clears after restoration", () => {
    mockProfile = { ...mockProfile, type: "presentation", outputIds: ["stream-b"] };
    const { rerender } = render(
      <GlobalInfoContext.Provider
        value={{
          realtimeConnected: true,
          contentHiddenByOutput: { "stream-b": { hidden: true, confirmed: false } },
        } as never}
      >
        <ContentHiddenStatus />
      </GlobalInfoContext.Provider>,
    );
    expect(screen.getByRole("status", { name: /Syncing/ })).toBeInTheDocument();
    rerender(
      <GlobalInfoContext.Provider
        value={{
          realtimeConnected: true,
          contentHiddenByOutput: { "stream-b": { hidden: true, confirmed: true } },
        } as never}
      >
        <ContentHiddenStatus />
      </GlobalInfoContext.Provider>,
    );
    expect(screen.getByRole("status", { name: "Content Hidden on Sanctuary" })).toBeInTheDocument();
    rerender(
      <GlobalInfoContext.Provider
        value={{
          realtimeConnected: true,
          contentHiddenByOutput: { "stream-b": { hidden: false, confirmed: true } },
        } as never}
      >
        <ContentHiddenStatus />
      </GlobalInfoContext.Provider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
