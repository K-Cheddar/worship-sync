import { fireEvent, render, screen } from "@testing-library/react";
import QuickLinkSelection from "./QuickLinkSelection";

const mockDispatch = jest.fn();
const mockRemoveToast = jest.fn();
const mockShowToast = jest.fn();

const mockState = {
  undoable: {
    present: {
      item: {
        _id: "item-1",
        type: "song",
        selectedSlide: 0,
        slides: [],
        name: "Item Name",
        timerInfo: undefined,
      },
      overlay: {
        selectedOverlay: {
          id: "stb-1",
          type: "stick-to-bottom",
          duration: 10,
          heading: "Welcome",
          subHeading: "Glad you're here",
          formatting: {
            backgroundColor: "#123456",
          },
        },
      },
    },
  },
};

const displayWindowMock = jest.fn((_props: unknown) => (
  <div data-testid="overlay-preview" />
));

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
    removeToast: mockRemoveToast,
  }),
}));

jest.mock("../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: (props: unknown) => displayWindowMock(props),
}));

describe("QuickLinkSelection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses stick-to-bottom heading and formatting in preview and saved quick link payload", () => {
    render(
      <QuickLinkSelection
        linkType="overlay"
        quickLinkId="ql-1"
        toastId="toast-1"
        displayType="stream"
      />
    );

    const previewProps = displayWindowMock.mock.calls[0]?.[0] as any;
    expect(previewProps.stbOverlayInfo.heading).toBe("Welcome");
    expect(previewProps.stbOverlayInfo.subHeading).toBe("Glad you're here");
    expect(previewProps.stbOverlayInfo.formatting.backgroundColor).toBe("#123456");

    fireEvent.click(screen.getByRole("button", { name: "Select Overlay" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          stbOverlayInfo: expect.objectContaining({
            heading: "Welcome",
            subHeading: "Glad you're here",
            formatting: expect.objectContaining({
              backgroundColor: "#123456",
            }),
          }),
        }),
      })
    );
  });
});
