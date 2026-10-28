import { createPortal } from "react-dom";
import { render, screen, within } from "@testing-library/react";
import type { ControllerProfile } from "../../../utils/controllerProfiles";
import { getDefaultControllerProfiles } from "../../../utils/controllerProfiles";
import type { DisplayOutput } from "../../../utils/displayOutputs";
import { getDefaultDisplayOutputs } from "../../../utils/displayOutputs";
import type { ShouldSendTo } from "../../../types";
import ItemEditTools from "./ItemEditTools";
import AllToolsDrawer from "./AllToolsDrawer";

type MockToolbarState = {
  undoable: { present: { item: { shouldSendTo: ShouldSendTo } } };
  displayOutputs: { list: DisplayOutput[] };
  controllerProfiles: { list: ControllerProfile[] };
};

const mockDispatch = jest.fn();
let mockState: MockToolbarState;

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: MockToolbarState) => unknown) =>
    selector(mockState),
}));

const createMockToolbarState = (): MockToolbarState => {
  const outputs = [
    ...getDefaultDisplayOutputs(),
    { id: "lobby", type: "projector" as const, name: "Lobby", order: 6, enabled: true },
  ];
  const profiles = getDefaultControllerProfiles();
  profiles[0] = {
    ...profiles[0],
    outputIds: ["projector", "monitor", "stream", "lobby"],
    outputsConfigured: true,
  };

  return {
    undoable: {
      present: {
        item: {
          shouldSendTo: {
            projector: true,
            monitor: true,
            stream: true,
            outputIds: ["projector", "monitor", "stream", "lobby"],
          },
        },
      },
    },
    displayOutputs: { list: outputs },
    controllerProfiles: { list: profiles },
  };
};

describe("AllToolsDrawer quick toolbar targets", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockState = createMockToolbarState();
  });

  it("provides explicitly ordered groups in one horizontally scrollable row", () => {
    render(
      <AllToolsDrawer
        isOpen={false}
        onClose={jest.fn()}
        onToggle={jest.fn()}
        isMobile={false}
        showBibleMode={true}
        showStreamFormatting={false}
        showOutputTargets={false}
      >
        {(targets) => (
          <>
            {targets.quickFontSize &&
              createPortal(<button type="button">Font Size</button>, targets.quickFontSize)}
            {targets.quickBoxLayout &&
              createPortal(<button type="button">Layout</button>, targets.quickBoxLayout)}
            {targets.quickBoxHeight &&
              createPortal(<button type="button">Height</button>, targets.quickBoxHeight)}
            {targets.quickBrightness &&
              createPortal(<button type="button">Brightness</button>, targets.quickBrightness)}
            {targets.quickBibleMode &&
              createPortal(<button type="button">Bible Mode</button>, targets.quickBibleMode)}
          </>
        )}
      </AllToolsDrawer>,
    );

    const scroll = screen.getByTestId("quick-editing-toolbar-scroll");
    const row = screen.getByTestId("quick-editing-toolbar-groups");
    expect(scroll).toHaveClass("overflow-x-auto");
    expect(row).toHaveClass("flex", "min-w-max");
    expect(
      within(scroll).getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Font Size", "Layout", "Height", "Brightness", "Bible Mode"]);
    expect(screen.getByRole("button", { name: "All Tools" })).toBeInTheDocument();
  });

  it("omits the Bible group target for non-Bible items", () => {
    render(
      <AllToolsDrawer
        isOpen={false}
        onClose={jest.fn()}
        onToggle={jest.fn()}
        isMobile={false}
        showBibleMode={false}
        showStreamFormatting={false}
        showOutputTargets={false}
      >
        {() => null}
      </AllToolsDrawer>,
    );

    expect(screen.queryByTestId("quick-toolbar-bible-mode")).not.toBeInTheDocument();
  });

  it("shows the updated section headings and keeps Stream Formatting unchanged", () => {
    render(
      <AllToolsDrawer
        isOpen={true}
        onClose={jest.fn()}
        onToggle={jest.fn()}
        isMobile={false}
        showBibleMode={false}
        showStreamFormatting={true}
        showOutputTargets={true}
      >
        {() => null}
      </AllToolsDrawer>,
    );

    expect(screen.getByRole("heading", { name: "Text & Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Position & Size" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stream Formatting" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Show On" })).toBeInTheDocument();
    expect(
      screen.getByText("Choose where this item appears when sent live."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Output Targets" })).not.toBeInTheDocument();
  });

  it("renders configured display toggles in Show On and updates only item targets", () => {
    render(
      <AllToolsDrawer
        isOpen={true}
        onClose={jest.fn()}
        onToggle={jest.fn()}
        isMobile={false}
        showBibleMode={false}
        showStreamFormatting={false}
        showOutputTargets={true}
      >
        {(targets) => <ItemEditTools drawerTarget={targets.outputTargets} />}
      </AllToolsDrawer>,
    );

    const showOnHeading = screen.getByRole("heading", { name: "Show On" });
    expect(showOnHeading).toBeInTheDocument();
    for (const name of ["Projector", "Monitor", "Stream", "Lobby"]) {
      expect(screen.getByRole("switch", { name: `${name}:` })).toBeInTheDocument();
    }

    screen.getByRole("switch", { name: "Lobby:" }).click();

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "item/setShouldSendTo",
        payload: expect.objectContaining({
          outputIds: ["projector", "monitor", "stream"],
          projector: true,
          monitor: true,
          stream: true,
        }),
      }),
    );
  });
});
