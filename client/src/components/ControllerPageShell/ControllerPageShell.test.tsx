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
      <ControllerPageShell>
        <PreviewModeProbe />
      </ControllerPageShell>,
    );

    expect(screen.getByTestId("preview-mode")).toHaveTextContent("projector");
    fireEvent.click(
      screen.getByRole("button", { name: "Select Stream from toolbar" }),
    );
    expect(screen.getByTestId("preview-mode")).toHaveTextContent("stream");
  });

  it("mounts the opaque startup overlay above controller content until the database is ready", () => {
    render(
      <ControllerPageShell
        dbProgress={47}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      >
        <div data-testid="controller-page-content">Controller content</div>
      </ControllerPageShell>,
    );

    const overlay = screen.getByTestId("controller-loading-overlay");
    expect(overlay).toHaveClass("fixed", "inset-0", "z-[60]", "bg-homepage-canvas");
    expect(overlay).not.toHaveClass("bg-homepage-canvas/90");
    expect(screen.getByTestId("controller-page-content")).toBeInTheDocument();
    expect(screen.getByText("Database sync: 47%")).toBeInTheDocument();
  });
});
