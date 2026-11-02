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

jest.mock("./ControllerLoadingOverlay", () => ({
  __esModule: true,
  default: () => null,
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
});
