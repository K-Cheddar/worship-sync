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

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      index: 1,
      value: "Original words",
      commitMode: "immediate",
      box: expect.objectContaining({ x: 50, y: 50 }),
    }));
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

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      index: 1,
      value: "Original words",
      commitMode: "immediate",
      box: expect.objectContaining({
        width: 50,
        height: 50,
        x: 10,
        y: 10,
      }),
    }));
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

  it("syncs the textarea value while focused when upstream words change", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const overflowBox = {
      ...baseBox,
      words: "Line 1\nLine 2",
    };
    const { rerender } = render(
      <DisplayEditor box={overflowBox} width={960} onChange={onChange} index={1} />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    await user.type(textarea, "\nLine 3");

    expect(textarea.value).toContain("Line 3");

    rerender(
      <DisplayEditor
        box={{ ...overflowBox, words: "Line 1" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    expect(textarea.value).toBe("Line 1");
  });

  it("anchors scroll to the top when upstream overflow text is reformatted out of the slide", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const overflowBox = {
      ...baseBox,
      words: "Line 1\nLine 2",
    };
    const { rerender } = render(
      <DisplayEditor box={overflowBox} width={960} onChange={onChange} index={1} />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    await user.type(textarea, "\nLine 3");
    textarea.scrollTop = 120;

    rerender(
      <DisplayEditor
        box={{ ...overflowBox, words: "Line 1" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    expect(textarea.value).toBe("Line 1");
    expect(textarea.scrollTop).toBe(0);
  });

  it("keeps the textarea anchored to the top when scrolling is not expanded", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <DisplayEditor
        box={{ ...baseBox, words: "Line 1\nLine 2\nLine 3" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    textarea.scrollTop = 140;

    fireEvent.scroll(textarea);

    expect(textarea.scrollTop).toBe(0);
  });

  it("does not flush stale overflow text on blur after upstream reformat", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const overflowBox = {
      ...baseBox,
      words: "Line 1\nLine 2",
    };
    const { rerender } = render(
      <DisplayEditor box={overflowBox} width={960} onChange={onChange} index={1} />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    await user.type(textarea, "\nLine 3");

    onChange.mockClear();

    rerender(
      <DisplayEditor
        box={{ ...overflowBox, words: "Line 1" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    fireEvent.blur(textarea);

    expect(textarea.value).toBe("Line 1");
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        commitMode: "flush",
        value: expect.stringContaining("Line 3"),
      })
    );
  });

  it("continues typing from the reformatted slide text after upstream overflow changes", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const overflowBox = {
      ...baseBox,
      words: "Line 1\nLine 2",
    };
    const { rerender } = render(
      <DisplayEditor box={overflowBox} width={960} onChange={onChange} index={1} />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    await user.type(textarea, "\nLine 3");

    rerender(
      <DisplayEditor
        box={{ ...overflowBox, words: "Line 1" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    onChange.mockClear();
    await user.type(textarea, " updated");

    expect(textarea.value).toBe("Line 1 updated");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        commitMode: "typing",
        value: "Line 1 updated",
      })
    );
  });

  it("syncs focused draft when the upstream box is replaced with the same words", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const baseOverflowBox = {
      ...baseBox,
      words: "Line 1",
      x: 0,
    };
    const { rerender } = render(
      <DisplayEditor box={baseOverflowBox} width={960} onChange={onChange} index={1} />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    await user.type(textarea, " overflow");

    expect(textarea.value).toBe("Line 1 overflow");

    rerender(
      <DisplayEditor
        box={{ ...baseOverflowBox, x: 5, words: "Line 1" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    expect(textarea.value).toBe("Line 1");

    onChange.mockClear();
    fireEvent.blur(textarea);

    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        commitMode: "flush",
        value: "Line 1 overflow",
      })
    );
  });

  it("keeps the cursor where the user is editing when upstream text grows after reformat", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <DisplayEditor
        box={{ ...baseBox, words: "Line 1\nLine 2" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    textarea.setSelectionRange(1, 1);
    textarea.scrollTop = 80;

    rerender(
      <DisplayEditor
        box={{ ...baseBox, words: "Line 1\nLine 2\nLine 3" }}
        width={960}
        onChange={onChange}
        index={1}
      />
    );

    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(1);
    expect(textarea.scrollTop).toBe(0);
  });

  it("uses the requested cursor position after upstream reformat sync", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <DisplayEditor
        box={{ ...baseBox, words: "Line 1\nLine 2" }}
        width={960}
        onChange={onChange}
        index={1}
        desiredCursorPosition={1}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.scrollTop = 90;

    rerender(
      <DisplayEditor
        box={{ ...baseBox, words: "Line 1\nLine 2\nLine 3" }}
        width={960}
        onChange={onChange}
        index={1}
        desiredCursorPosition={1}
      />
    );

    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(1);
    expect(textarea.scrollTop).toBe(0);
  });
});
