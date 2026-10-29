import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import BoxEditor from "./BoxEditor";
import type { ItemState } from "../../../types";

const mockDispatch = jest.fn();
const mockShowToast = jest.fn();
const mockRemoveToast = jest.fn();
const mockUpdateBoxProperties = jest.fn((args: { item: ItemState }) => args.item);
const mockApplyOwnedContentMutation = jest.fn((payload: unknown) => ({
  type: "item/applyOwnedContentMutation",
  payload,
}));
const mockItemHasCleanableNewlines = jest.fn();
const mockCleanItemNewlines = jest.fn((item: ItemState) => ({
  ...item,
  slides: [{ id: "cleaned-slide", type: "Media", name: "Cleaned", boxes: [] }],
}));

let mockState: { undoable: { present: { item: ItemState } } };

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
    removeToast: mockRemoveToast,
  }),
}));

jest.mock("../../../utils/formatter", () => ({
  updateBoxProperties: (args: { item: ItemState }) => mockUpdateBoxProperties(args),
}));

jest.mock("../../../store/itemSlice", () => ({
  setItemFormatting: jest.fn((value: boolean) => ({
    type: "item/setItemFormatting",
    payload: value,
  })),
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

const makeItem = (overrides: Partial<ItemState> = {}): ItemState =>
  ({
    _id: "item-default",
    contentOwner: {
      scopeId: "test-church/test-db",
      databaseKey: "test-db",
      churchId: "test-church",
    },
    name: "Item",
    type: "song",
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    slides: [
      {
        id: "slide-1",
        type: "Media",
        name: "Slide 1",
        boxes: [
          { id: "bg", width: 100, height: 100, x: 0, y: 0 },
          { id: "text", width: 50, height: 50, x: 0, y: 0, words: "Words" },
        ],
      },
    ],
    arrangements: [
      {
        id: "arr-1",
        name: "Master",
        slides: [],
        songOrder: [],
        formattedLyrics: [
          { id: "lyric-1", type: "Verse", name: "Verse 1", words: "One\n\nTwo", slideSpan: 1 },
        ],
      },
    ],
    shouldSendTo: { projector: true, monitor: true, stream: true },
    ...overrides,
  }) as ItemState;

describe("BoxEditor", () => {
  const renderEditor = (
    updateItem: (item: ItemState) => void,
    quickBoxLayoutTarget: HTMLElement | null = null,
    quickBoxHeightTarget: HTMLElement | null = null,
    drawerTarget: HTMLElement | null = document.body,
  ) =>
    render(
      <BoxEditor
        updateItem={updateItem}
        quickBoxLayoutTarget={quickBoxLayoutTarget}
        quickBoxHeightTarget={quickBoxHeightTarget}
        drawerTarget={drawerTarget}
      />,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-29T12:00:00.000Z"));
    jest.clearAllMocks();
    mockState = {
      undoable: {
        present: {
          item: makeItem({ _id: `item-${Math.random()}` }),
        },
      },
    };
    mockItemHasCleanableNewlines.mockReturnValue(true);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("shows a cleanup toast after a song width change with cleanable newlines", () => {
    const updateItem = jest.fn();

    renderEditor(updateItem);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ itemId: mockState.undoable.present.item._id }),
        mutation: expect.objectContaining({
          kind: "boxProperties",
          properties: expect.objectContaining({ width: 60 }),
        }),
      }),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "This song has extra blank lines. Remove them?",
      })
    );
  });

  it("shows a cleanup toast after a free-item height change with cleanable newlines", () => {
    mockState.undoable.present.item = makeItem({
      _id: "free-item-1",
      type: "free",
      arrangements: [],
      formattedSections: [
        { id: "section-1", sectionNum: 1, words: "One\n\nTwo", slideSpan: 1 },
      ],
    });
    const updateItem = jest.fn();

    renderEditor(updateItem);

    fireEvent.change(screen.getByLabelText(/Height/i), {
      target: { value: "60" },
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "This custom item has extra blank lines. Remove them?",
      })
    );
  });

  it("does not show a cleanup toast for x-only changes", () => {
    const updateItem = jest.fn();

    renderEditor(updateItem);

    fireEvent.change(screen.getByLabelText(/^X/i), {
      target: { value: "10" },
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ itemId: mockState.undoable.present.item._id }),
        mutation: expect.objectContaining({
          kind: "boxProperties",
          properties: expect.objectContaining({ x: 10 }),
        }),
      }),
    );
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("does not show a cleanup toast for unsupported item types", () => {
    mockState.undoable.present.item = makeItem({
      _id: "image-item-1",
      type: "image",
      arrangements: [],
    });
    const updateItem = jest.fn();

    renderEditor(updateItem);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("throttles the cleanup toast to once per minute per item", () => {
    const updateItem = jest.fn();

    renderEditor(updateItem);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "70" },
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it("allows a different item to show the cleanup toast immediately", () => {
    const updateItem = jest.fn();
    const { rerender } = render(
      <BoxEditor
        updateItem={updateItem}
        quickBoxLayoutTarget={null}
        quickBoxHeightTarget={null}
        drawerTarget={document.body}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });
    act(() => {
      jest.runAllTimers();
    });

    mockState.undoable.present.item = makeItem({ _id: "different-item-1" });
    rerender(
      <BoxEditor
        updateItem={updateItem}
        quickBoxLayoutTarget={null}
        quickBoxHeightTarget={null}
        drawerTarget={document.body}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "70" },
    });
    act(() => {
      jest.runAllTimers();
    });

    expect(mockShowToast).toHaveBeenCalledTimes(2);
  });

  it("clicking the toast action cleans newlines and closes the toast", () => {
    const updateItem = jest.fn();

    renderEditor(updateItem);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });
    act(() => {
      jest.runAllTimers();
    });

    const { children: renderToastChildren } = mockShowToast.mock.calls[0][0];
    render(<>{renderToastChildren("toast-1")}</>);

    fireEvent.click(screen.getByRole("button", { name: "Remove blank lines" }));

    act(() => {
      jest.runAllTimers();
    });

    expect(mockCleanItemNewlines).toHaveBeenCalledWith(mockState.undoable.present.item);
    expect(updateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        slides: [{ id: "cleaned-slide", type: "Media", name: "Cleaned", boxes: [] }],
      }),
      expect.objectContaining({ itemId: mockState.undoable.present.item._id }),
    );
    expect(mockRemoveToast).toHaveBeenCalledWith("toast-1");
  });

  it("clicking Keep as is dismisses the toast without cleaning", () => {
    const updateItem = jest.fn();

    renderEditor(updateItem);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });
    act(() => {
      jest.runAllTimers();
    });

    const { children: renderToastChildren } = mockShowToast.mock.calls[0][0];
    render(<>{renderToastChildren("toast-2")}</>);

    fireEvent.click(screen.getByRole("button", { name: "Keep as is" }));

    expect(mockCleanItemNewlines).not.toHaveBeenCalled();
    expect(mockRemoveToast).toHaveBeenCalledWith("toast-2");
  });

  it.each([
    ["Full", { x: 0, y: 0, width: 100, height: 100 }],
    ["50% Middle", { x: 0, y: 20, width: 100, height: 55 }],
    ["Lower Third", { x: 0, y: 65, width: 100, height: 35 }],
    ["Middle Third", { x: 0, y: 35, width: 100, height: 35 }],
    ["Match", { x: 0, y: 0, width: 50, height: 50 }],
  ])("applies the exact %s quick preset geometry", (label, dimensions) => {
    const quickLayoutTarget = document.createElement("div");
    const quickHeightTarget = document.createElement("div");
    document.body.append(quickLayoutTarget, quickHeightTarget);
    const view = renderEditor(jest.fn(), quickLayoutTarget, quickHeightTarget, null);

    act(() => {
      within(quickLayoutTarget)
        .getByRole("button", { name: `Apply ${label} box preset` })
        .click();
      jest.runAllTimers();
    });

    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          kind: "boxProperties",
          properties: dimensions,
          applyToAll: true,
        }),
      }),
    );

    view.unmount();
    quickLayoutTarget.remove();
    quickHeightTarget.remove();
  });

  it("shows five icon presets under Layout with tooltips for the active scope", () => {
    const quickLayoutTarget = document.createElement("div");
    const quickHeightTarget = document.createElement("div");
    document.body.append(quickLayoutTarget, quickHeightTarget);
    const view = renderEditor(jest.fn(), quickLayoutTarget, quickHeightTarget, null);

    expect(within(quickLayoutTarget).getByText("Layout")).toBeVisible();
    for (const label of ["Full", "50% Middle", "Lower Third", "Middle Third", "Match"]) {
      expect(
        within(quickLayoutTarget).getByRole("button", {
          name: `Apply ${label} box preset`,
        }),
      ).toBeInTheDocument();
    }
    expect(
      within(quickLayoutTarget).getByRole("button", { name: "Apply Full box preset" }),
    ).toHaveAttribute("title", "Apply Full box preset to all slides");
    expect(
      within(quickHeightTarget).getByRole("group", { name: "Height" }),
    ).toBeInTheDocument();
    expect(within(quickHeightTarget).getByText(/^Height:$/)).toBeVisible();

    view.unmount();
    quickLayoutTarget.remove();
    quickHeightTarget.remove();
  });

  it("keeps the ten existing presets in All Tools and disables Match for This slide scope", () => {
    renderEditor(jest.fn());

    for (const label of [
      "Full",
      "50% Middle",
      "90% Middle",
      "Top 20%",
      "Left Half",
      "Right Half",
      "Lower Third",
      "Middle Third",
      "Upper Third",
    ]) {
      expect(
        screen.getByRole("button", { name: `Apply ${label} box preset` }),
      ).toBeInTheDocument();
    }

    const match = screen.getByRole("button", { name: "Apply Match box preset" });
    expect(match).toBeEnabled();
    expect(screen.getByText("Layouts")).toBeVisible();
    const presetContainer = screen.getByTestId("box-layout-drawer-presets");
    expect(presetContainer).toBeInTheDocument();
    for (const button of within(presetContainer).getAllByRole("button")) {
      expect(within(button).getByTestId("box-preset-icon")).toHaveClass("w-16", "md:w-10", "aspect-video");
      expect(button).toHaveClass("min-h-12");
    }
    expect(within(presetContainer).queryByText("Full")).not.toBeInTheDocument();
    expect(
      within(presetContainer)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Apply Full box preset",
      "Apply 50% Middle box preset",
      "Apply 90% Middle box preset",
      "Apply Top 20% box preset",
      "Apply Left Half box preset",
      "Apply Right Half box preset",
      "Apply Lower Third box preset",
      "Apply Middle Third box preset",
      "Apply Upper Third box preset",
      "Apply Match box preset",
    ]);
    expect(
      screen.getByRole("radiogroup", { name: "Apply changes to" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All slides" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByText(/Geometry applies to/)).not.toBeInTheDocument();
    act(() => screen.getByRole("radio", { name: "This slide" }).click());
    expect(match).toBeDisabled();
    expect(screen.getByRole("radio", { name: "This slide" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("keeps custom items scoped to This slide by default", () => {
    mockState.undoable.present.item = makeItem({
      type: "free",
      arrangements: [],
    });

    renderEditor(jest.fn());

    expect(screen.getByRole("radio", { name: "This slide" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "All slides" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("wraps box controls inside a narrow All Tools drawer", () => {
    const drawerTarget = document.createElement("div");
    drawerTarget.style.width = "240px";
    document.body.append(drawerTarget);
    const view = renderEditor(jest.fn(), null, null, drawerTarget);

    expect(within(drawerTarget).getByTestId("box-layout-drawer-controls")).toHaveClass(
      "min-w-0",
    );
    expect(within(drawerTarget).getByTestId("box-layout-drawer-presets")).toHaveClass(
      "flex-wrap",
    );

    view.unmount();
    drawerTarget.remove();
  });

  it("shares geometry scope and height drafts between the quick row and drawer", () => {
    const quickLayoutTarget = document.createElement("div");
    const quickHeightTarget = document.createElement("div");
    const drawerTarget = document.createElement("div");
    document.body.append(quickLayoutTarget, quickHeightTarget, drawerTarget);
    const view = renderEditor(jest.fn(), quickLayoutTarget, quickHeightTarget, drawerTarget);

    act(() => {
      within(drawerTarget)
        .getByRole("radio", { name: "This slide" })
        .click();
    });
    expect(
      within(quickLayoutTarget).getByRole("button", { name: "Apply Match box preset" }),
    ).toBeDisabled();

    fireEvent.change(within(drawerTarget).getByRole("spinbutton", { name: /height/i }), {
      target: { value: "62" },
    });
    expect(within(quickHeightTarget).getByRole("spinbutton", { name: /height/i })).toHaveValue(62);

    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          kind: "boxProperties",
          properties: expect.objectContaining({ height: 62 }),
          applyToAll: false,
        }),
      }),
    );

    view.unmount();
    quickLayoutTarget.remove();
    quickHeightTarget.remove();
    drawerTarget.remove();
  });

  it("keeps a pending height edit when the All Tools target closes", () => {
    const quickLayoutTarget = document.createElement("div");
    const quickHeightTarget = document.createElement("div");
    const drawerTarget = document.createElement("div");
    document.body.append(quickLayoutTarget, quickHeightTarget, drawerTarget);
    const view = renderEditor(jest.fn(), quickLayoutTarget, quickHeightTarget, drawerTarget);

    fireEvent.change(within(drawerTarget).getByRole("spinbutton", { name: /height/i }), {
      target: { value: "64" },
    });
    view.rerender(
      <BoxEditor
        updateItem={jest.fn()}
        quickBoxLayoutTarget={quickLayoutTarget}
        quickBoxHeightTarget={quickHeightTarget}
        drawerTarget={null}
      />,
    );

    expect(within(quickHeightTarget).getByRole("spinbutton", { name: /height/i })).toHaveValue(64);
    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          kind: "boxProperties",
          properties: expect.objectContaining({ height: 64 }),
        }),
      }),
    );

    view.unmount();
    quickLayoutTarget.remove();
    quickHeightTarget.remove();
    drawerTarget.remove();
  });

  it("flushes a pending height edit to its original slide when the selection changes", () => {
    const updateItem = jest.fn();
    const view = renderEditor(updateItem);
    fireEvent.change(screen.getByRole("spinbutton", { name: /height/i }), {
      target: { value: "70" },
    });

    const currentItem = mockState.undoable.present.item;
    mockState.undoable.present.item = {
      ...currentItem,
      selectedSlide: 1,
      slides: [
        currentItem.slides[0],
        {
          ...currentItem.slides[0],
          id: "slide-2",
          boxes: currentItem.slides[0].boxes.map((box) => ({
            ...box,
            id: `${box.id}-2`,
          })),
        },
      ],
    };
    view.rerender(
      <BoxEditor
        updateItem={updateItem}
        quickBoxLayoutTarget={null}
        quickBoxHeightTarget={null}
        drawerTarget={document.body}
      />,
    );

    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ itemId: currentItem._id }),
        mutation: expect.objectContaining({
          slideId: "slide-1",
          targetBoxId: "text",
          properties: expect.objectContaining({ height: 70 }),
        }),
      }),
    );
  });

  it("flushes pending geometry when the song arrangement changes", () => {
    const updateItem = jest.fn();
    const view = renderEditor(updateItem);
    fireEvent.change(screen.getByRole("spinbutton", { name: /height/i }), {
      target: { value: "70" },
    });

    const currentItem = mockState.undoable.present.item;
    mockState.undoable.present.item = {
      ...currentItem,
      selectedArrangement: 1,
      arrangements: [
        ...currentItem.arrangements,
        { ...currentItem.arrangements[0], id: "arr-2", name: "Medley" },
      ],
    };
    view.rerender(
      <BoxEditor
        updateItem={updateItem}
        quickBoxLayoutTarget={null}
        quickBoxHeightTarget={null}
        drawerTarget={document.body}
      />,
    );

    act(() => jest.advanceTimersByTime(0));
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          arrangementId: "arr-1",
          slideId: "slide-1",
          properties: expect.objectContaining({ height: 70 }),
        }),
      }),
    );
  });

  it("flushes pending geometry with its original church and item owner", () => {
    const updateItem = jest.fn();
    const view = renderEditor(updateItem);
    fireEvent.change(screen.getByRole("spinbutton", { name: /height/i }), {
      target: { value: "70" },
    });
    const originalItem = mockState.undoable.present.item;
    mockState.undoable.present.item = {
      ...originalItem,
      _id: "new-active-item",
      contentOwner: {
        scopeId: "other-church/other-db",
        databaseKey: "other-db",
        churchId: "other-church",
      },
    };
    view.rerender(
      <BoxEditor
        updateItem={updateItem}
        quickBoxLayoutTarget={null}
        quickBoxHeightTarget={null}
        drawerTarget={document.body}
      />,
    );

    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({
          scopeId: "test-church/test-db",
          itemId: originalItem._id,
        }),
        mutation: expect.objectContaining({
          slideId: "slide-1",
          properties: expect.objectContaining({ height: 70 }),
        }),
      }),
    );
  });

  it("commits a pending numeric edit when the editor unmounts", () => {
    const view = renderEditor(jest.fn());
    fireEvent.change(screen.getByRole("spinbutton", { name: /height/i }), {
      target: { value: "64" },
    });

    view.unmount();
    act(() => jest.runAllTimers());
    expect(mockApplyOwnedContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          properties: expect.objectContaining({ height: 64 }),
        }),
      }),
    );
  });
});
