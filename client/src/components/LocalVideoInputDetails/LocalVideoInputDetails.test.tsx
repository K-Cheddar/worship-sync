import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LocalVideoInputDetails from "./LocalVideoInputDetails";
import type { LocalVideoInputMediaSource } from "../../types";
import { resolveLocalVideoInputBinding } from "../../utils/localVideoInput";

jest.mock("../../utils/localVideoInput", () => {
  const actual = jest.requireActual("../../utils/localVideoInput");
  return {
    ...actual,
    resolveLocalVideoInputBinding: jest.fn(),
  };
});

const mockResolve = jest.mocked(resolveLocalVideoInputBinding);

const source: LocalVideoInputMediaSource = {
  kind: "local-video-input",
  sourceId: "local_video_1",
  label: "Booth camera",
  captureKind: "device",
  fit: "contain",
};

describe("LocalVideoInputDetails", () => {
  beforeEach(() => {
    mockResolve.mockReturnValue({
      sourceId: "local_video_1",
      deviceId: "cam-1",
      deviceLabel: "HD Webcam",
      captureKind: "device",
    });
  });

  it("shows name, linked input, and fit", () => {
    render(
      <LocalVideoInputDetails
        source={source}
        canEdit
        onEdit={jest.fn()}
      />,
    );

    const panel = screen.getByTestId("local-video-input-details");
    expect(
      within(panel).getByText("Video input", { selector: ".font-semibold" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Booth camera")).toBeInTheDocument();
    expect(screen.getByText("HD Webcam")).toBeInTheDocument();
    expect(screen.getByText("Fit entire frame")).toBeInTheDocument();
  });

  it("labels a screen share and its source field", () => {
    mockResolve.mockReturnValue({
      sourceId: "local_video_1",
      deviceId: "screen:0:0",
      deviceLabel: "Screen 1",
      captureKind: "screen",
    });

    render(
      <LocalVideoInputDetails
        source={{
          ...source,
          label: "Lyrics screen",
          captureKind: "screen",
        }}
        canEdit
        onEdit={jest.fn()}
      />,
    );

    expect(screen.getByText("Screen share")).toBeInTheDocument();
    expect(screen.getByText("Screen")).toBeInTheDocument();
    expect(screen.getByText("Lyrics screen")).toBeInTheDocument();
    expect(screen.getByText("Screen 1")).toBeInTheDocument();
  });

  it("calls onEdit when Edit is clicked", async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    render(
      <LocalVideoInputDetails source={source} canEdit onEdit={onEdit} />,
    );

    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("hides Edit when read-only", () => {
    render(<LocalVideoInputDetails source={source} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });
});
