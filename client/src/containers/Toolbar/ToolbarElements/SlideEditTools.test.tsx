import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import SlideEditTools from "./SlideEditTools";
import type { ItemState } from "../../../types";

const mockDispatch = jest.fn();
const mockItemHasCleanableNewlines = jest.fn();
const mockCleanItemNewlines = jest.fn((item: ItemState) => ({
  ...item,
  slides: [{ id: "cleaned-slide", type: "Section", name: "Section 1", boxes: [] }],
  formattedSections: [{ id: "section-1", sectionNum: 1, words: "Cleaned", slideSpan: 1 }],
}));
const mockUpdateSlides = jest.fn((payload: unknown) => ({
  type: "item/updateSlides",
  payload,
}));
const mockUpdateArrangements = jest.fn((payload: unknown) => ({
  type: "item/updateArrangements",
  payload,
}));
const mockUpdateBibleInfo = jest.fn((payload: unknown) => ({
  type: "item/updateBibleInfo",
  payload,
}));
const mockApplyOwnedContentMutation = jest.fn((payload: unknown) => ({
  type: "item/applyOwnedContentMutation",
  payload,
}));

let mockState: {
  undoable: { present: { item: ItemState } };
  timers: { timers: any[] };
};

let mockPathname = "/controller";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: mockPathname }),
}));

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../../store/itemSlice", () => ({
  setItemFormatting: jest.fn((value: boolean) => ({
    type: "item/setItemFormatting",
    payload: value,
  })),
  updateArrangements: (payload: unknown) => mockUpdateArrangements(payload),
  updateBibleInfo: (payload: unknown) => mockUpdateBibleInfo(payload),
  updateSlides: (payload: unknown) => mockUpdateSlides(payload),
  applyOwnedContentMutation: (payload: unknown) =>
    mockApplyOwnedContentMutation(payload),
}));

jest.mock("../../../utils/itemNewlineCleanup", () => ({
  itemHasCleanableNewlines: (item: ItemState) => mockItemHasCleanableNewlines(item),
  cleanItemNewlines: (item: ItemState) => mockCleanItemNewlines(item),
}));

jest.mock("../../../components/PopOver/PopoverPanel", () => ({
  __esModule: true,
  default: ({ TriggeringButton, children }: { TriggeringButton: ReactNode; children?: ReactNode }) => (
    <>{TriggeringButton}{children}</>
  ),
}));

jest.mock("../../../components/ColorField/ColorField", () => ({
  BrandAwareColorPicker: ({ onChange }: { onChange: (color: string) => void }) => (
    <button type="button" onClick={() => onChange("#ff00ff")}>
      Choose test font color
    </button>
  ),
}));

jest.mock("react-colorful", () => ({
  HexColorPicker: () => null,
  HexColorInput: () => null,
}));

const makeItem = (overrides: Partial<ItemState> = {}): ItemState =>
  ({
    _id: "free-item-1",
    contentOwner: {
      scopeId: "test-church/test-db",
      databaseKey: "test-db",
      churchId: "test-church",
    },
    name: "Free Item",
    type: "free",
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    slides: [
      {
        id: "slide-1",
        type: "Section",
        name: "Section 1",
        boxes: [
          { id: "bg", width: 100, height: 100, x: 0, y: 0, brightness: 100 },
          {
            id: "text",
            width: 50,
            height: 50,
            x: 0,
            y: 0,
            words: "One",
            fontSize: 40,
            fontColor: "#ffffff",
            align: "left",
          },
        ],
        overflow: "fit",
      },
    ],
    arrangements: [],
    formattedSections: [
      { id: "section-1", sectionNum: 1, words: "One\n\nTwo", slideSpan: 1 },
    ],
    shouldSendTo: { projector: true, monitor: true, stream: true },
    ...overrides,
  }) as ItemState;

describe("SlideEditTools", () => {
  const renderTools = (
    quickFontSizeTarget: HTMLElement | null = null,
    drawerTarget: HTMLElement | null = document.body,
    quickBrightnessTarget: HTMLElement | null = null,
    quickBibleModeTarget: HTMLElement | null = null,
    applyToAll = true,
  ) =>
    render(
      <SlideEditTools
        quickFontSizeTarget={quickFontSizeTarget}
        quickBrightnessTarget={quickBrightnessTarget}
        quickBibleModeTarget={quickBibleModeTarget}
        drawerTarget={drawerTarget}
        applyToAll={applyToAll}
      />,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPathname = "/controller";
    mockState = {
      undoable: {
        present: {
          item: makeItem(),
        },
      },
      timers: { timers: [] },
    };
    mockItemHasCleanableNewlines.mockReturnValue(true);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("renders the Remove Blank Lines button for free items", () => {
    renderTools();

    expect(
      screen.getByRole("button", { name: "Remove Blank Lines" })
    ).toBeInTheDocument();
  });

  it("reads formatting from the selected song arrangement with empty root slides", () => {
    const song = makeItem({
      _id: "song-1",
      type: "song",
      slides: [],
      arrangements: [{
        id: "arr-1",
        name: "Master",
        songOrder: [],
        formattedLyrics: [],
        slides: [{
          id: "song-slide",
          type: "Verse",
          name: "Verse 1",
          boxes: [
            { id: "bg", width: 100, height: 100, brightness: 80 },
            { id: "text", width: 50, height: 50, words: "Song words", fontSize: 64, fontColor: "#123456", isBold: true, align: "center" },
          ],
        }],
      }],
    });
    mockState.undoable.present.item = song;

    renderTools();

    expect(screen.getByDisplayValue("64")).toBeInTheDocument();
  });

  it("renders tools on an auxiliary controller item route", () => {
    mockPathname = "/aux-controller/ctrl_lobby";
    renderTools();

    expect(
      screen.getByRole("button", { name: "Remove Blank Lines" }),
    ).toBeInTheDocument();
  });

  it("dispatches an owner-bound newline cleanup when the button is clicked", () => {
    renderTools();

    fireEvent.click(screen.getByRole("button", { name: "Remove Blank Lines" }));

    act(() => {
      jest.runAllTimers();
    });

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith({
      owner: {
        scopeId: "test-church/test-db",
        databaseKey: "test-db",
        churchId: "test-church",
        itemId: "free-item-1",
        itemType: "free",
      },
      mutation: {
        kind: "cleanNewlines",
      },
    });
  });

  it("shares direct font-size input between the quick toolbar and All Tools", () => {
    const quickTarget = document.createElement("div");
    const drawerTarget = document.createElement("div");
    document.body.append(quickTarget, drawerTarget);
    renderTools(quickTarget, drawerTarget);

    expect(within(quickTarget).getByRole("group", { name: "Font Size" })).toHaveAttribute(
      "title",
      "Font Size",
    );
    expect(within(quickTarget).getByTestId("quick-toolbar-font-size-icon")).toBeInTheDocument();
    expect(within(quickTarget).getByText(/^Font Size:$/)).toHaveClass("sr-only");
    fireEvent.change(within(drawerTarget).getByRole("textbox", { name: /Font Size/ }), {
      target: { value: "48" },
    });
    expect(within(quickTarget).getByRole("textbox", { name: /Font Size/ })).toHaveValue("48");

    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ itemId: "free-item-1" }),
        mutation: expect.objectContaining({
          kind: "boxProperties",
          properties: { fontSize: 48 },
          formatItem: true,
          applyToAll: true,
        }),
      }),
    );
    quickTarget.remove();
    drawerTarget.remove();
  });

  it("applies brightness to the background using the shared all-slides scope", () => {
    const secondSlide = {
      ...mockState.undoable.present.item.slides[0],
      id: "slide-2",
      boxes: mockState.undoable.present.item.slides[0].boxes.map((box) => ({
        ...box,
        id: `${box.id}-2`,
        brightness: 100,
      })),
    };
    mockState.undoable.present.item.slides.push(secondSlide);
    renderTools();

    fireEvent.change(screen.getByRole("spinbutton", { name: /Brightness/ }), {
      target: { value: "45" },
    });
    act(() => jest.runAllTimers());

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          kind: "boxProperties",
          properties: { brightness: 45 },
          applyToAll: true,
          updateBackgroundOnly: true,
          skipTitleSlide: false,
        }),
      }),
    );
    expect(mockUpdateSlides).not.toHaveBeenCalled();
  });

  it.each([
    ["Choose test font color", { fontColor: "#ff00ff" }, true],
    ["Bold", { isBold: true }, true],
    ["Italic", { isItalic: true }, true],
    ["Align right", { align: "right" }, true],
    ["Choose test font color", { fontColor: "#ff00ff" }, false],
    ["Bold", { isBold: true }, false],
    ["Italic", { isItalic: true }, false],
    ["Align right", { align: "right" }, false],
  ])("applies %s formatting changes with applyToAll=%s", (control, property, applyToAll) => {
    renderTools(null, document.body, null, null, applyToAll);

    fireEvent.click(screen.getByRole("button", { name: control }));
    act(() => jest.runAllTimers());

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          kind: "boxProperties",
          properties: property,
          applyToAll,
        }),
      }),
    );
  });

  it("uses the selected-slide scope for background brightness", () => {
    renderTools(null, document.body, null, null, false);

    fireEvent.change(screen.getByRole("spinbutton", { name: /Brightness/ }), {
      target: { value: "45" },
    });
    act(() => jest.runAllTimers());

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          properties: { brightness: 45 },
          applyToAll: false,
          updateBackgroundOnly: true,
        }),
      }),
    );

  });

  it.each([true, false])(
    "applies Keep Aspect Ratio using applyToAll=%s",
    (applyToAll) => {
      renderTools(null, document.body, null, null, applyToAll);

      fireEvent.click(screen.getByRole("switch", { name: /Keep Aspect Ratio/ }));
      act(() => jest.runAllTimers());

      expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({
            kind: "boxProperties",
            properties: { shouldKeepAspectRatio: true },
            applyToAll,
            updateBackgroundOnly: true,
          }),
        }),
      );
    },
  );

  it("captures the font-size scope when a typed change is queued", () => {
    const view = renderTools();
    fireEvent.change(screen.getByRole("textbox", { name: /Font Size/ }), {
      target: { value: "48" },
    });

    view.rerender(
      <SlideEditTools
        quickFontSizeTarget={null}
        quickBrightnessTarget={null}
        quickBibleModeTarget={null}
        drawerTarget={document.body}
        applyToAll={false}
      />,
    );
    act(() => jest.runAllTimers());

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          properties: { fontSize: 48 },
          applyToAll: true,
        }),
      }),
    );
  });

  it("captures the font-color scope when a delayed color change is queued", () => {
    const view = renderTools(null, document.body, null, null, true);
    fireEvent.click(screen.getByRole("button", { name: "Choose test font color" }));

    view.rerender(
      <SlideEditTools
        quickFontSizeTarget={null}
        quickBrightnessTarget={null}
        quickBibleModeTarget={null}
        drawerTarget={document.body}
        applyToAll={false}
      />,
    );
    act(() => jest.runAllTimers());

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ itemId: "free-item-1" }),
        mutation: expect.objectContaining({
          slideId: "slide-1",
          targetBoxId: "text",
          properties: { fontColor: "#ff00ff" },
          applyToAll: true,
        }),
      }),
    );
  });

  it("uses selected-slide scope for typed and incremented font sizes", () => {
    renderTools(null, document.body, null, null, false);

    fireEvent.change(screen.getByRole("textbox", { name: /Font Size/ }), {
      target: { value: "48" },
    });
    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          properties: { fontSize: 48 },
          applyToAll: false,
        }),
      }),
    );

    mockApplyOwnedContentMutation.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Increase font size" }));
    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          properties: { fontSize: 49 },
          applyToAll: false,
        }),
      }),
    );

    mockApplyOwnedContentMutation.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Decrease font size" }));
    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          properties: { fontSize: 48 },
          applyToAll: false,
        }),
      }),
    );
  });

  it("uses selected-slide scope for font-size presets", () => {
    renderTools(null, document.body, null, null, false);

    const presetButton = screen.getByRole("button", { name: "Font size presets" });
    fireEvent.keyDown(presetButton, { key: "Enter", code: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "60" }));
    act(() => jest.runAllTimers());

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          properties: { fontSize: 60 },
          applyToAll: false,
        }),
      }),
    );
  });

  it("keeps a debounced font-size change on its original slide after navigation", () => {
    const view = renderTools();
    fireEvent.change(screen.getByRole("textbox", { name: /Font Size/ }), {
      target: { value: "48" },
    });
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      selectedSlide: 1,
      slides: [
        ...mockState.undoable.present.item.slides,
        {
          ...mockState.undoable.present.item.slides[0],
          id: "slide-2",
          boxes: mockState.undoable.present.item.slides[0].boxes.map((box) => ({
            ...box,
            id: `${box.id}-2`,
          })),
        },
      ],
    };
    view.rerender(
      <SlideEditTools
        quickFontSizeTarget={null}
        quickBrightnessTarget={null}
        quickBibleModeTarget={null}
        drawerTarget={document.body}
        applyToAll={false}
      />,
    );
    act(() => jest.runAllTimers());

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          slideId: "slide-1",
          targetBoxId: "text",
          properties: { fontSize: 48 },
          applyToAll: true,
        }),
      }),
    );
  });

  it("uses the sun icon and accessible label for quick background brightness", () => {
    const brightnessTarget = document.createElement("div");
    document.body.append(brightnessTarget);
    renderTools(null, null, brightnessTarget);

    expect(
      within(brightnessTarget).getByRole("group", { name: "Background brightness" }),
    ).toHaveAttribute("title", "Adjust background brightness");
    expect(
      within(brightnessTarget).getByTestId("quick-toolbar-brightness-icon"),
    ).toBeInTheDocument();
    expect(within(brightnessTarget).getByText(/^Brightness:$/)).toHaveClass("sr-only");
    brightnessTarget.remove();
  });

  it("wraps slide formatting controls inside a narrow All Tools drawer", () => {
    const drawerTarget = document.createElement("div");
    drawerTarget.style.width = "240px";
    document.body.append(drawerTarget);
    const view = renderTools(null, drawerTarget);

    expect(
      within(drawerTarget).getByTestId("slide-formatting-drawer-controls"),
    ).toHaveClass("min-w-0");
    for (const testId of [
      "slide-formatting-text-controls",
      "slide-formatting-mode-controls",
      "slide-formatting-brightness-controls",
    ]) {
      expect(within(drawerTarget).getByTestId(testId)).toHaveClass("flex-wrap");
    }

    view.unmount();
    drawerTarget.remove();
  });

  it("does not render an empty separator between text and brightness for songs", () => {
    const slide = makeItem().slides[0];
    mockState.undoable.present.item = makeItem({
      type: "song",
      arrangements: [{ id: "arrangement", name: "Default", slides: [slide], formattedLyrics: [], songOrder: [] }],
    });
    const drawerTarget = document.createElement("div");
    document.body.append(drawerTarget);
    const view = renderTools(null, drawerTarget);
    expect(within(drawerTarget).queryByTestId("slide-formatting-mode-controls")).not.toBeInTheDocument();
    expect(within(drawerTarget).getByTestId("slide-formatting-brightness-controls")).toHaveClass("border-t", "border-gray-600");
    view.unmount();
    drawerTarget.remove();
  });

  it("shows Bible mode in the quick toolbar only for Bible items", () => {
    mockState.undoable.present.item = makeItem({
      type: "bible",
      bibleInfo: { book: "John", chapter: "3", version: "NIV", verses: [], fontMode: "fit" },
    });
    const quickTarget = document.createElement("div");
    const drawerTarget = document.createElement("div");
    document.body.append(quickTarget, drawerTarget);
    const view = renderTools(null, drawerTarget, null, quickTarget);
    expect(within(quickTarget).getByRole("group", { name: "Bible mode" })).toBeInTheDocument();
    expect(within(quickTarget).getByRole("radio", { name: /Multiple/ })).toBeInTheDocument();
    expect(within(quickTarget).getByTestId("quick-toolbar-bible-icon")).toBeInTheDocument();

    mockState.undoable.present.item = makeItem();
    view.rerender(
      <SlideEditTools
        quickFontSizeTarget={null}
        quickBrightnessTarget={null}
        quickBibleModeTarget={quickTarget}
        drawerTarget={drawerTarget}
      />,
    );
    expect(
      within(quickTarget).queryByRole("group", { name: "Bible mode" }),
    ).not.toBeInTheDocument();
    quickTarget.remove();
    drawerTarget.remove();
  });
});
