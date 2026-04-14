import { act, fireEvent, render, screen } from "@testing-library/react";
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

let mockState: {
  undoable: { present: { item: ItemState } };
  timers: { timers: any[] };
};

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/controller/item" }),
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

jest.mock("react-colorful", () => ({
  HexColorPicker: () => null,
  HexColorInput: () => null,
}));

const makeItem = (overrides: Partial<ItemState> = {}): ItemState =>
  ({
    _id: "free-item-1",
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
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
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
    render(<SlideEditTools />);

    expect(
      screen.getByRole("button", { name: "Remove Blank Lines" })
    ).toBeInTheDocument();
  });

  it("cleans free items through the shared helper when the button is clicked", () => {
    render(<SlideEditTools />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Blank Lines" }));

    act(() => {
      jest.runAllTimers();
    });

    expect(mockCleanItemNewlines).toHaveBeenCalledWith(mockState.undoable.present.item);
    expect(mockUpdateSlides).toHaveBeenCalledWith({
      slides: [{ id: "cleaned-slide", type: "Section", name: "Section 1", boxes: [] }],
      formattedSections: [
        { id: "section-1", sectionNum: 1, words: "Cleaned", slideSpan: 1 },
      ],
    });
  });
});
