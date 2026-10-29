import { render, screen, fireEvent } from "@testing-library/react";
import SlideBoxes from "./SlideBoxes";

const mockDispatch = jest.fn();
let mockState: any;

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../store/itemSlice", () => ({
  setSelectedBox: jest.fn((value: number) => ({
    type: "item/setSelectedBox",
    payload: value,
  })),
  updateBoxes: jest.fn((payload: unknown) => ({
    type: "item/updateBoxes",
    payload,
  })),
}));

const mockSetFocusMediaId = jest.fn((id: string) => ({
  type: "preferences/setFocusMediaId",
  payload: id,
}));
const mockSetIsMediaExpanded = jest.fn((value: boolean) => ({
  type: "preferences/setIsMediaExpanded",
  payload: value,
}));
const mockSetRequestOpenMediaPanel = jest.fn((value: boolean) => ({
  type: "preferences/setRequestOpenMediaPanel",
  payload: value,
}));

jest.mock("../../store/preferencesSlice", () => ({
  setFocusMediaId: (id: string) => mockSetFocusMediaId(id),
  setIsMediaExpanded: (value: boolean) => mockSetIsMediaExpanded(value),
  setRequestOpenMediaPanel: (value: boolean) =>
    mockSetRequestOpenMediaPanel(value),
}));

describe("SlideBoxes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      undoable: {
        present: {
          item: {
            type: "free",
            selectedSlide: 0,
            selectedBox: 0,
            arrangements: [],
            selectedArrangement: 0,
            slides: [
              {
                id: "s1",
                name: "Section 1",
                type: "Section",
                mediaSource: {
                  kind: "local-video-input",
                  sourceId: "local_video_1",
                  label: "Booth camera",
                },
                boxes: [
                  { id: "b0", width: 100, height: 100, words: "", x: 0, y: 0 },
                  {
                    id: "b1",
                    width: 80,
                    height: 40,
                    words: "Hello",
                    x: 10,
                    y: 30,
                  },
                ],
              },
            ],
          },
        },
      },
      media: {
        list: [
          {
            id: "media-live-1",
            name: "Booth camera",
            localVideoInput: {
              kind: "local-video-input",
              sourceId: "local_video_1",
              label: "Booth camera",
            },
          },
        ],
      },
    };
  });

  it("uses Redux selection and exposes only permitted box actions", () => {
    const setLocked = jest.fn();
    const props = { canEdit: true, canDeleteBox: (index: number) => index === 1, isBoxLocked: [true, false], setIsBoxLocked: setLocked };
    const { rerender } = render(<SlideBoxes {...props} />);
    expect(screen.getByRole("button", { name: /Video input: Booth camera/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hello" }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: "item/setSelectedBox", payload: 1 });
    mockState.undoable.present.item.selectedBox = 1;
    rerender(<SlideBoxes {...props} />);
    expect(screen.getByRole("button", { name: "Hello" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    expect(setLocked.mock.calls[0][0]([true, false])).toEqual([true, true]);
    fireEvent.click(screen.getByRole("button", { name: "Add Box" }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: "item/setSelectedBox", payload: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Delete Hello" }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "item/updateBoxes", payload: { boxes: [expect.objectContaining({ id: "b0" })] } }));
    rerender(<SlideBoxes {...props} canEdit={false} />);
    expect(screen.getByRole("button", { name: "Lock" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add Box" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Hello" })).not.toBeInTheDocument();
  });

  it("labels the background box with the video input name", () => {
    render(
      <SlideBoxes
        canEdit
        canDeleteBox={() => false}
        isBoxLocked={[true, true]}
        setIsBoxLocked={jest.fn()}
      />,
    );

    expect(screen.getByText("Video input: Booth camera")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("can focus the matching live input in Media", () => {
    render(
      <SlideBoxes
        canEdit
        canDeleteBox={() => false}
        isBoxLocked={[true, true]}
        setIsBoxLocked={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show in Media/i }));

    expect(mockSetRequestOpenMediaPanel).toHaveBeenCalledWith(true);
    expect(mockSetIsMediaExpanded).toHaveBeenCalledWith(true);
    expect(mockSetFocusMediaId).toHaveBeenCalledWith("media-live-1");
  });

  it("focuses library media by id so the panel can navigate to its folder", () => {
    mockState = {
      undoable: {
        present: {
          item: {
            type: "image",
            selectedSlide: 0,
            selectedBox: 0,
            arrangements: [],
            selectedArrangement: 0,
            slides: [
              {
                id: "s1",
                name: "Section 1",
                type: "Section",
                boxes: [
                  {
                    id: "b0",
                    width: 100,
                    height: 100,
                    words: "",
                    x: 0,
                    y: 0,
                    background: "local-image://local_image_1",
                    mediaInfo: {
                      id: "local_image_1",
                      name: "1000063547.png",
                      type: "image",
                      background: "local-image://local_image_1",
                      folderId: "folder-photos",
                    },
                  },
                ],
              },
            ],
          },
        },
      },
      media: {
        list: [
          {
            id: "local_image_1",
            name: "1000063547.png",
            type: "image",
            background: "local-image://local_image_1",
            folderId: "folder-photos",
          },
        ],
      },
    };

    render(
      <SlideBoxes
        canEdit
        canDeleteBox={() => false}
        isBoxLocked={[true]}
        setIsBoxLocked={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show in Media/i }));

    expect(mockSetFocusMediaId).toHaveBeenCalledWith("local_image_1");
  });
});
