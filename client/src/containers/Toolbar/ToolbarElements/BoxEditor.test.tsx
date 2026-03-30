import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import BoxEditor from "./BoxEditor";
import type { ItemState } from "../../../types";

const mockDispatch = jest.fn();
const mockShowToast = jest.fn();
const mockRemoveToast = jest.fn();
const mockUpdateBoxProperties = jest.fn((args: { item: ItemState }) => args.item);
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
}));

jest.mock("../../../utils/itemNewlineCleanup", () => ({
  itemHasCleanableNewlines: (item: ItemState) => mockItemHasCleanableNewlines(item),
  cleanItemNewlines: (item: ItemState) => mockCleanItemNewlines(item),
}));

jest.mock("../../../components/PopOver/PopOver", () => ({
  __esModule: true,
  default: ({ TriggeringButton }: { TriggeringButton: ReactNode }) => (
    <>{TriggeringButton}</>
  ),
}));

const makeItem = (overrides: Partial<ItemState> = {}): ItemState =>
  ({
    _id: "item-default",
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

    render(<BoxEditor updateItem={updateItem} isMobile={false} />);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(updateItem).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Looks like you have extra new lines in your text. Would you like to clean them up?",
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

    render(<BoxEditor updateItem={updateItem} isMobile={false} />);

    fireEvent.change(screen.getByLabelText(/Height/i), {
      target: { value: "60" },
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(mockShowToast).toHaveBeenCalled();
  });

  it("does not show a cleanup toast for x-only changes", () => {
    const updateItem = jest.fn();

    render(<BoxEditor updateItem={updateItem} isMobile={false} />);

    fireEvent.change(screen.getByLabelText(/^X/i), {
      target: { value: "10" },
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(updateItem).toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("does not show a cleanup toast for unsupported item types", () => {
    mockState.undoable.present.item = makeItem({
      _id: "image-item-1",
      type: "image",
      arrangements: [],
    });
    const updateItem = jest.fn();

    render(<BoxEditor updateItem={updateItem} isMobile={false} />);

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

    render(<BoxEditor updateItem={updateItem} isMobile={false} />);

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
    const { rerender } = render(<BoxEditor updateItem={updateItem} isMobile={false} />);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });
    act(() => {
      jest.runAllTimers();
    });

    mockState.undoable.present.item = makeItem({ _id: "different-item-1" });
    rerender(<BoxEditor updateItem={updateItem} isMobile={false} />);

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

    render(<BoxEditor updateItem={updateItem} isMobile={false} />);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });
    act(() => {
      jest.runAllTimers();
    });

    const toastArgs = mockShowToast.mock.calls[0][0];
    render(<>{toastArgs.children("toast-1")}</>);

    fireEvent.click(screen.getByRole("button", { name: "Yes please" }));

    act(() => {
      jest.runAllTimers();
    });

    expect(mockCleanItemNewlines).toHaveBeenCalledWith(mockState.undoable.present.item);
    expect(updateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        slides: [{ id: "cleaned-slide", type: "Media", name: "Cleaned", boxes: [] }],
      })
    );
    expect(mockRemoveToast).toHaveBeenCalledWith("toast-1");
  });

  it("clicking No thanks dismisses the toast without cleaning", () => {
    const updateItem = jest.fn();

    render(<BoxEditor updateItem={updateItem} isMobile={false} />);

    fireEvent.change(screen.getByLabelText(/Width/i), {
      target: { value: "60" },
    });
    act(() => {
      jest.runAllTimers();
    });

    const toastArgs = mockShowToast.mock.calls[0][0];
    render(<>{toastArgs.children("toast-2")}</>);

    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));

    expect(mockCleanItemNewlines).not.toHaveBeenCalled();
    expect(mockRemoveToast).toHaveBeenCalledWith("toast-2");
  });
});
