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
  default: ({ TriggeringButton }: { TriggeringButton: ReactNode }) => (
    <>{TriggeringButton}</>
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
  ) =>
    render(
      <SlideEditTools
        quickFontSizeTarget={quickFontSizeTarget}
        quickBrightnessTarget={quickBrightnessTarget}
        quickBibleModeTarget={quickBibleModeTarget}
        drawerTarget={drawerTarget}
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
        }),
      }),
    );
    quickTarget.remove();
    drawerTarget.remove();
  });

  it("keeps brightness applying to the background across the item", () => {
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

    expect(mockUpdateSlides).toHaveBeenCalledWith(
      expect.objectContaining({
        slides: expect.arrayContaining([
          expect.objectContaining({ boxes: expect.arrayContaining([expect.objectContaining({ brightness: 45 })]) }),
        ]),
      }),
    );
    const updatedSlides = mockUpdateSlides.mock.calls.at(-1)?.[0] as {
      slides: Array<{ boxes: Array<{ brightness?: number }> }>;
    };
    expect(updatedSlides.slides.every((slide) => slide.boxes[0].brightness === 45)).toBe(true);
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
