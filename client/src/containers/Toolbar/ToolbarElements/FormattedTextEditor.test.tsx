import { fireEvent, render, screen } from "@testing-library/react";
import FormattedTextEditor from "./FormattedTextEditor";
import type { ItemState } from "../../../types";

const mockDispatch = jest.fn();
const mockUpdateSlides = jest.fn((payload: unknown) => ({
  type: "item/updateSlides",
  payload,
}));

let mockItem: ItemState;

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ undoable: { present: { item: mockItem } } }),
}));

jest.mock("../../../store/itemSlice", () => ({
  updateSlides: (payload: unknown) => mockUpdateSlides(payload),
}));

describe("FormattedTextEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockItem = {
      _id: "song-1",
      name: "Song",
      type: "song",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      slides: [],
      arrangements: [{
        id: "arr-1",
        name: "Master",
        songOrder: [],
        formattedLyrics: [],
        slides: [{
          id: "slide-1",
          type: "Verse",
          name: "Verse 1",
          boxes: [],
          formattedTextDisplayInfo: {
            text: "Song stream text",
            backgroundColor: "#111111",
            textColor: "#eeeeee",
            fontSize: 5.2,
            paddingX: 4,
            paddingY: 3,
            align: "center",
            isBold: true,
            isItalic: false,
          },
        }],
      }],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } as ItemState;
  });

  it("reads and edits formatted text from the selected song arrangement", () => {
    render(<FormattedTextEditor />);

    const fontSize = screen.getByDisplayValue("52");
    expect(screen.getByLabelText(/Padding X/i)).toHaveValue(4);
    expect(screen.getByLabelText(/Padding Y/i)).toHaveValue(3);
    fireEvent.change(fontSize, { target: { value: "60" } });

    expect(mockUpdateSlides).toHaveBeenCalledWith({
      slides: [expect.objectContaining({
        formattedTextDisplayInfo: expect.objectContaining({ fontSize: 6 }),
      })],
    });
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "item/updateSlides",
    }));
  });
});
