import { createPortal } from "react-dom";
import { render, screen, within } from "@testing-library/react";
import AllToolsDrawer from "./AllToolsDrawer";

describe("AllToolsDrawer quick toolbar targets", () => {
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
});
