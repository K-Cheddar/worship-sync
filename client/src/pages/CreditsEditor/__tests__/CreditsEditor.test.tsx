import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import CreditsEditor from "../CreditsEditor";
import { configureStore } from "@reduxjs/toolkit";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { creditsSlice } from "../../../store/creditsSlice";
import { overlaysSlice } from "../../../store/overlaysSlice";
import undoable from "redux-undo";
import {
  createMockControllerContext,
  createMockGlobalContext,
  createMockPouchDB,
} from "../../../test/mocks";

// controllerInfo uses import.meta – replaced by jest.config.cjs moduleNameMapper (__mocks__)
// ResizeObserver – setupTests.ts

// Mock the components and hooks
jest.mock("../../../containers/Credits/Credits", () => () => (
  <div data-testid="credits-preview">Credits Preview</div>
));
jest.mock("../../../containers/Credits/CreditsEditor", () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => (
    <div data-testid="credits-editor" className={className}>
      Credits Editor
    </div>
  ),
}));
jest.mock(
  "../../../containers/Toolbar/ToolbarElements/UserSection",
  () => () => <div data-testid="user-section">User Section</div>,
);
jest.mock("../../../containers/Toolbar/ToolbarElements/Undo", () => () => (
  <div data-testid="undo">Undo</div>
));
jest.mock("firebase/database", () => ({
  ref: jest.fn(),
  onValue: jest.fn(),
}));

// Mock the Excel utility
jest.mock("../../../utils/getScheduleFromExcel", () => {
  const mockSchedule = [
    { heading: "Sabbath School", names: "John Doe\nJane Smith" },
    { heading: "Welcome", names: "Jane Smith" },
    { heading: "Call to Praise", names: "Elder Praise" },
    { heading: "Invocation", names: "Elder Invocation" },
    { heading: "Reading of the Word", names: "The Reader" },
    { heading: "Intercessory Prayer", names: "Mrs. Prayer Ministry" },
    { heading: "Offertory", names: "Treasurer" },
    { heading: "Special Song", names: "Special Singer" },
    { heading: "Sermon", names: "The Pastor" },
    { heading: "Technical Director", names: "Mr. Director" },
    {
      heading: "Production Coordinators",
      names: "Coordinator 1\nCoordinator 2",
    },
    {
      heading: "Audio Engineers",
      names: "Front of House - Mr. Mixer\nOnline - Mrs. Studio",
    },
    {
      heading: "Camera Operators",
      names: "Camera 1\nCamera 2\nCamera 3\nCamera 4",
    },
    { heading: "Graphics", names: "Graphics Team" },
  ];

  return jest.fn().mockImplementation(() => {
    return Promise.resolve(mockSchedule);
  });
});

interface RootState {
  credits: ReturnType<typeof creditsSlice.reducer>;
  overlays: ReturnType<typeof overlaysSlice.reducer>;
}

const mockPouchDB = createMockPouchDB();
const mockControllerContext = createMockControllerContext({ db: mockPouchDB });
const mockGlobalContext = createMockGlobalContext();

// Mock redux hooks (must export createAsyncThunk - itemSlice imports it via store)
jest.mock("../../../hooks/reduxHooks", () => {
  const { createAsyncThunk } = require("@reduxjs/toolkit");
  const { creditsSlice } = require("../../../store/creditsSlice");
  const { overlaysSlice } = require("../../../store/overlaysSlice");
  let mockDispatch = jest.fn();

  const mockState = {
    undoable: {
      present: {
        credits: {
          ...creditsSlice.getInitialState(),
          list: [
            { id: "1", heading: "Sabbath School", text: "" },
            { id: "2", heading: "Welcome", text: "" },
            { id: "3", heading: "Call to Praise", text: "" },
            { id: "4", heading: "Invocation", text: "" },
            { id: "5", heading: "Reading of the Word", text: "" },
            { id: "6", heading: "Intercessory Prayer", text: "" },
            { id: "7", heading: "Offertory", text: "" },
            { id: "8", heading: "Special Song", text: "" },
            { id: "9", heading: "Sermon", text: "" },
            { id: "10", heading: "Technical Director", text: "" },
            { id: "11", heading: "Production Coordinators", text: "" },
            { id: "12", heading: "Audio Engineers", text: "" },
            { id: "13", heading: "Camera Operators", text: "" },
            { id: "14", heading: "Graphics", text: "" },
          ],
          isLoading: false,
        },
        overlays: {
          ...overlaysSlice.getInitialState(),
          list: [
            { id: "1", name: "Test Overlay", event: "sabbath school" },
            { id: "2", name: "Welcome Overlay", event: "welcome" },
            { id: "3", name: "Praise Overlay", event: "call to praise" },
            { id: "4", name: "Invocation Overlay", event: "invocation" },
            { id: "5", name: "Reading Overlay", event: "reading" },
            { id: "6", name: "Prayer Overlay", event: "intercessor" },
            { id: "7", name: "Offertory Overlay", event: "offertory" },
            { id: "8", name: "Special Overlay", event: "special" },
            { id: "9", name: "Sermon Overlay", event: "sermon" },
          ],
        },
      },
    },
  };

  return {
    useDispatch: () => mockDispatch,
    useSelector: (selector: any) => selector(mockState),
    createAsyncThunk,
    __setMockDispatch: (dispatch: any) => {
      mockDispatch = dispatch;
    },
    __getMockState: () => mockState,
  };
});

describe("CreditsEditor", () => {
  let mockDispatch: jest.Mock;
  let mockStore: ReturnType<typeof configureStore>;

  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <Provider store={mockStore}>
        <ControllerInfoContext.Provider
          value={mockControllerContext as React.ComponentProps<
            typeof ControllerInfoContext.Provider
          >["value"]}
        >
          <GlobalInfoContext.Provider value={mockGlobalContext}>
            <BrowserRouter>{component}</BrowserRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDispatch = jest.fn();
    require("../../../hooks/reduxHooks").__setMockDispatch(mockDispatch);

    // Create the mock store with initial state
    const mockState = require("../../../hooks/reduxHooks").__getMockState();

    mockStore = configureStore({
      reducer: {
        undoable: undoable(
          (state: RootState = mockState.undoable.present, action) => {
            return {
              ...state,
              credits: creditsSlice.reducer(state.credits, action),
              overlays: overlaysSlice.reducer(state.overlays, action),
            };
          },
          {
            filter: () => true,
          },
        ),
      },
    });

    // Set up the mock selector to return the initial state
    jest
      .spyOn(require("../../../hooks/reduxHooks"), "useSelector")
      .mockImplementation((selector: any) => selector(mockState));
  });

  it("renders the editor and preview sections", () => {
    renderWithProviders(<CreditsEditor />);

    expect(screen.getByTestId("credits-editor")).toBeInTheDocument();
    expect(screen.getByTestId("credits-preview")).toBeInTheDocument();
  });

  it("shows loading state when dbProgress is not 100", () => {
    const contextWithLoading = {
      ...mockControllerContext,
      dbProgress: 50,
    };

    render(
      <Provider store={mockStore}>
        <ControllerInfoContext.Provider
          value={contextWithLoading as React.ComponentProps<
            typeof ControllerInfoContext.Provider
          >["value"]}
        >
          <GlobalInfoContext.Provider value={mockGlobalContext}>
            <BrowserRouter>
              <CreditsEditor />
            </BrowserRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    // Check for the loading overlay (dbProgress may be undefined if context is mocked globally)
    const loadingOverlay = screen.getByTestId("loading-overlay");
    expect(loadingOverlay).toBeInTheDocument();
    expect(loadingOverlay).toHaveTextContent(/Setting up/);
    expect(loadingOverlay).toHaveTextContent(/Progress:.*%/);
  });

  it("toggles preview mode on mobile", async () => {
    renderWithProviders(<CreditsEditor />);

    const showPreviewButton = screen.getByRole("button", {
      name: "Show Preview",
    });
    const showEditorButton = screen.getByRole("button", {
      name: "Show Editor",
    });

    // Initially both sections should be visible
    expect(screen.getByTestId("credits-editor")).toBeVisible();
    expect(screen.getByTestId("credits-preview")).toBeVisible();

    // Click preview button: editor gets max-md:hidden (hidden on mobile)
    fireEvent.click(showPreviewButton);
    await waitFor(() => {
      expect(screen.getByTestId("credits-editor")).toHaveClass("max-md:hidden");
    });

    // Click editor button: preview container gets max-md:hidden
    fireEvent.click(showEditorButton);
    await waitFor(() => {
      expect(screen.getByTestId("credits-preview-container")).toHaveClass(
        "max-md:hidden",
      );
    });
  });

  it("updates transition and credits scenes", async () => {
    renderWithProviders(<CreditsEditor />);

    const transitionInput = screen.getByRole("textbox", {
      name: /transition scene:/i,
    });
    const creditsInput = screen.getByRole("textbox", {
      name: /credits scene:/i,
    });

    fireEvent.change(transitionInput, { target: { value: "New Transition" } });
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.stringContaining("credits/setTransitionScene"),
          payload: "New Transition",
        }),
      );
    });

    fireEvent.change(creditsInput, { target: { value: "New Credits" } });
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.stringContaining("credits/setCreditsScene"),
          payload: "New Credits",
        }),
      );
    });
  });


  it("handles database errors gracefully", async () => {
    const rejectingGet = jest.fn().mockRejectedValue({ name: "not_found" });
    const contextWithError = {
      ...mockControllerContext,
      db: {
        ...mockPouchDB,
        get: rejectingGet,
      },
    };

    render(
      <Provider store={mockStore}>
        <ControllerInfoContext.Provider
          value={contextWithError as React.ComponentProps<
            typeof ControllerInfoContext.Provider
          >["value"]}
        >
          <GlobalInfoContext.Provider value={mockGlobalContext}>
            <BrowserRouter>
              <CreditsEditor />
            </BrowserRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    // Component should render without crashing when db.get rejects (e.g. not_found).
    // Full error path (dispatch initiateCreditsList([]), db.put) runs when context is provided;
    // here we assert the component settles and the editor is visible.
    await waitFor(
      () => {
        expect(screen.getByTestId("credits-editor")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByTestId("credits-preview")).toBeInTheDocument();
  });
});
