import { fireEvent, render, screen } from "@testing-library/react";
import ControllerPageShell from "./ControllerPageShell";
import { useThumbnailPreviewMode } from "../../context/thumbnailPreviewMode";

jest.mock("../../containers/Toolbar/Toolbar", () => ({
  __esModule: true,
  default: () => {
    const { setPreviewMode } = require(
      "../../context/thumbnailPreviewMode",
    ).useThumbnailPreviewMode();
    return (
      <button type="button" onClick={() => setPreviewMode("stream")}>
        Select Stream from toolbar
      </button>
    );
  },
}));

const PreviewModeProbe = () => {
  const { previewMode } = useThumbnailPreviewMode();
  return <output data-testid="preview-mode">{previewMode}</output>;
};

describe("ControllerPageShell thumbnail preview state", () => {
  it("shares transient view state between the toolbar and page content", () => {
    render(
      <ControllerPageShell
        dbProgress={100}
        connectionStatus={{ status: "connected", retryCount: 0 }}
      >
        <PreviewModeProbe />
      </ControllerPageShell>,
    );

    expect(screen.getByTestId("preview-mode")).toHaveTextContent("projector");
    fireEvent.click(
      screen.getByRole("button", { name: "Select Stream from toolbar" }),
    );
    expect(screen.getByTestId("preview-mode")).toHaveTextContent("stream");
  });

  it("mounts the translucent startup overlay and disables controller interaction until the database is ready", () => {
    const { rerender } = render(
      <ControllerPageShell
        dbProgress={47}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      >
        <div data-testid="controller-page-content">Controller content</div>
      </ControllerPageShell>,
    );

    const overlay = screen.getByTestId("controller-loading-overlay");
    expect(overlay).toHaveClass("fixed", "inset-0", "z-[60]", "bg-homepage-canvas/85");
    expect(screen.getByTestId("controller-page-content")).toBeInTheDocument();
    expect(screen.getByText("Database sync: 47%")).toBeInTheDocument();

    const interactionLayer = screen.getByTestId("controller-interaction-layer");
    expect(interactionLayer).toHaveAttribute("inert");

    rerender(
      <ControllerPageShell
        dbProgress={100}
        connectionStatus={{ status: "connected", retryCount: 0 }}
      >
        <div data-testid="controller-page-content">Controller content</div>
      </ControllerPageShell>,
    );
    expect(interactionLayer).not.toHaveAttribute("inert");
    expect(screen.queryByTestId("controller-loading-overlay")).toBeNull();
  });
});
