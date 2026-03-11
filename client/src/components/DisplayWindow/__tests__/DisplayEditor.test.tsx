import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DisplayEditor from "../DisplayEditor";
import type { Box } from "../../../types";

const mockShowToast = jest.fn();
const mockUseCachedMediaUrl = jest.fn((url?: string) => url);

let latestRndProps: any = null;

jest.mock("../../../context/toastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => mockUseCachedMediaUrl(url),
}));

jest.mock("react-rnd", () => ({
  Rnd: (props: any) => {
    latestRndProps = props;
    if (typeof props.ref === "function") {
      props.ref({
        getSelfElement: () => document.createElement("div"),
      });
    }
    return <div data-testid="display-editor-rnd">{props.children}</div>;
  },
}));

const baseBox: Box = {
  id: "b1",
  words: "Original words",
  width: 50,
  height: 50,
  fontSize: 40,
  brightness: 100,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "",
  fontColor: "rgba(255,255,255,1)",
  shouldKeepAspectRatio: false,
  transparent: false,
  excludeFromOverflow: false,
  align: "center",
  slideIndex: 0,
  label: "Main",
  isBold: false,
  isItalic: false,
};

describe("DisplayEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    latestRndProps = null;
    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  it("converts drag-stop pixel coordinates to percentage coordinates", () => {
    const onChange = jest.fn();
    render(<DisplayEditor box={baseBox} width={960} onChange={onChange} index={1} />);

    act(() => {
      latestRndProps.onDragStop?.({}, { x: 960, y: 540 });
    });

    expect(onChange).toHaveBeenCalledWith({
      index: 1,
      value: "Original words",
      box: expect.objectContaining({ x: 50, y: 50 }),
    });
  });

  it("converts resize-stop dimensions and position into percentage values", () => {
    const onChange = jest.fn();
    render(<DisplayEditor box={baseBox} width={960} onChange={onChange} index={1} />);

    const ref = { style: { width: "960px", height: "540px" } } as HTMLElement;
    act(() => {
      latestRndProps.onResizeStop?.({}, "bottomRight", ref, { width: 0, height: 0 }, {
        x: 192,
        y: 108,
      });
    });

    expect(onChange).toHaveBeenCalledWith({
      index: 1,
      value: "Original words",
      box: expect.objectContaining({
        width: 50,
        height: 50,
        x: 10,
        y: 10,
      }),
    });
  });

  it("shows timer guidance toast when selecting the timer token", async () => {
    const onChange = jest.fn();
    render(
      <DisplayEditor
        box={{ ...baseBox, words: "Before {{timer}} after" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.click(textarea);
    textarea.setSelectionRange(10, 10);
    fireEvent.mouseUp(textarea);

    expect(mockShowToast).toHaveBeenCalledWith(
      "To edit the timer use the controls in the panel to the left",
      "info"
    );
  });
});
