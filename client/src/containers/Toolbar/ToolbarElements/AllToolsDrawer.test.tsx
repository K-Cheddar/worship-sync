import { createPortal } from "react-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ControllerProfile } from "../../../utils/controllerProfiles";
import { getDefaultControllerProfiles } from "../../../utils/controllerProfiles";
import type { DisplayOutput } from "../../../utils/displayOutputs";
import { getDefaultDisplayOutputs } from "../../../utils/displayOutputs";
import type { ShouldSendTo } from "../../../types";
import ItemEditTools from "./ItemEditTools";
import AllToolsDrawer from "./AllToolsDrawer";
import type { SlideEditingScope } from "../../../utils/slideEditingScope";

type MockToolbarState = {
  undoable: { present: { item: { shouldSendTo: ShouldSendTo } } };
  displayOutputs: { list: DisplayOutput[] };
  controllerProfiles: { list: ControllerProfile[] };
};

const mockDispatch = jest.fn();
const mockScopeChange = jest.fn();
let mockState: MockToolbarState;

const defaultScopeProps = {
  editingScope: "all" as const,
  onEditingScopeChange: mockScopeChange,
};

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

const ScopeHarness = () => {
  const [editingScope, setEditingScope] = useState<SlideEditingScope>("all");
  return (
    <AllToolsDrawer
      isOpen={true}
      onClose={jest.fn()}
      onToggle={jest.fn()}
      isMobile={false}
      showBibleMode={false}
      showStreamFormatting={false}
      showOutputTargets={false}
      editingScope={editingScope}
      onEditingScopeChange={setEditingScope}
    >
      {() => null}
    </AllToolsDrawer>
  );
};

describe("AllToolsDrawer quick toolbar targets", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockScopeChange.mockClear();
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
        {...defaultScopeProps}
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
    ).toEqual(["All slides", "Font Size", "Layout", "Height", "Brightness", "Bible Mode"]);
    expect(screen.getByRole("button", { name: "All Tools" })).toBeInTheDocument();
  });

  it("shows scrollable quick controls on mobile while retaining All Tools", () => {
    render(
      <AllToolsDrawer isOpen={false} onClose={jest.fn()} onToggle={jest.fn()}
        isMobile={true} showBibleMode={true} showStreamFormatting={false} showOutputTargets={false}
        {...defaultScopeProps}
      >
        {(targets) => targets.quickFontSize && createPortal(<button type="button">Font Size</button>, targets.quickFontSize)}
      </AllToolsDrawer>,
    );
    expect(screen.getByTestId("quick-editing-toolbar-scroll")).toBeVisible();
    expect(screen.getByRole("button", { name: "Font Size" })).toBeVisible();
    expect(screen.getByTestId("quick-editing-toolbar-groups")).toHaveClass("min-w-max");
    expect(screen.getByRole("button", { name: "All Tools" })).toBeVisible();
  });

  it("keeps the quick scope indicator and drawer radios synchronized without dispatching item changes", async () => {
    render(<ScopeHarness />);

    const scopeButton = screen.getByRole("button", {
      name: "Formatting scope: All slides",
    });
    expect(scopeButton).toHaveAttribute(
      "title",
      "Choose whether text, appearance, and layout changes apply to this slide or all slides",
    );
    expect(screen.getByRole("radio", { name: "All slides" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    const user = userEvent.setup();
    await user.click(scopeButton);
    await user.click(screen.getByRole("menuitemradio", { name: "This slide" }));
    expect(screen.getByRole("button", { name: "Formatting scope: This slide" })).toHaveTextContent(
      "This slide",
    );
    expect(screen.getByRole("radio", { name: "This slide" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Formatting scope: This slide" }));
    await user.click(screen.getByRole("menuitemradio", { name: "All slides" }));
    expect(screen.getByRole("button", { name: "Formatting scope: All slides" })).toHaveTextContent(
      "All slides",
    );
    expect(mockDispatch).not.toHaveBeenCalled();
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
        {...defaultScopeProps}
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
        {...defaultScopeProps}
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
        {...defaultScopeProps}
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

  it("opens the existing sheet at Show On without rendering Edit shortcuts", () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = jest.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const view = render(
        <div style={{ display: "none" }}>
          <AllToolsDrawer
            isOpen={true}
            onClose={jest.fn()}
            onToggle={jest.fn()}
            isMobile={false}
            showToolbarControls={false}
            scrollToOutputTargets={true}
            showBibleMode={false}
            showStreamFormatting={false}
            showOutputTargets={true}
            {...defaultScopeProps}
          >
            {(targets) => (
              <ItemEditTools drawerTarget={targets.outputTargets} />
            )}
          </AllToolsDrawer>
        </div>,
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
      expect(
        screen.getByRole("heading", { name: "Show On" }),
      ).toBeVisible();
      expect(
        screen.getByRole("switch", { name: "Projector:" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "All Tools" }),
      ).not.toBeInTheDocument();
      view.unmount();
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete (HTMLElement.prototype as { scrollIntoView?: () => void })
          .scrollIntoView;
      }
    }
  });
});
