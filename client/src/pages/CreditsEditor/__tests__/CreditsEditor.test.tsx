import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import CreditsEditor from "../CreditsEditor";
import { configureStore } from "@reduxjs/toolkit";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import { GlobalInfoContext } from "../../../context/globalInfo";
import PouchDB from "pouchdb";
import { Cloudinary } from "@cloudinary/url-gen";
import { Database } from "firebase/database";
import { creditsSlice } from "../../../store/creditsSlice";
import { overlaysSlice } from "../../../store/overlaysSlice";
import undoable from "redux-undo";

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = MockResizeObserver as any;

// Mock the components and hooks
jest.mock("../../../containers/Credits/Credits", () => () => (
  <div data-testid="credits-preview">Credits Preview</div>
));
jest.mock("../../../containers/Credits/CreditsEditor", () => () => (
  <div data-testid="credits-editor">Credits Editor</div>
));
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

// Create a mock PouchDB instance
const mockPouchDB = {
  get: jest.fn().mockResolvedValue({ _id: "credits", list: [] }),
  put: jest.fn(),
  find: jest.fn(),
  createIndex: jest.fn(),
  getIndexes: jest.fn(),
  deleteIndex: jest.fn(),
  // Add other required PouchDB methods as needed
} as unknown as PouchDB.Database;

// Create a mock EventTarget
class MockEventTarget implements EventTarget {
  private listeners: { [key: string]: EventListener[] } = {};

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(event: Event): boolean {
    const type = event.type;
    if (!this.listeners[type]) return true;
    this.listeners[type].forEach((listener) => listener(event));
    return true;
  }
}

// Create a mock Firebase Database
const mockFirebaseDb = {
  app: { name: "test" },
  type: "database",
  ref: jest.fn(),
  onValue: jest.fn(),
} as unknown as Database;

interface RootState {
  credits: ReturnType<typeof creditsSlice.reducer>;
  overlays: ReturnType<typeof overlaysSlice.reducer>;
}

const mockControllerContext = {
  db: mockPouchDB,
  dbProgress: 100,
  setIsMobile: jest.fn(),
  updater: new MockEventTarget(),
  bibleDb: undefined,
  cloud: new Cloudinary({
    cloud: {
      cloudName: "test",
    },
  }),
  isMobile: false,
  isPhone: false,
  bibleDbProgress: 100,
  setIsPhone: jest.fn(),
  logout: jest.fn(),
  login: jest.fn(),
};

const mockGlobalContext = {
  user: "test-user",
  firebaseDb: mockFirebaseDb,
  login: jest.fn(),
  logout: jest.fn(),
  loginState: "success" as const,
  database: "test",
  setDatabase: jest.fn(),
  setUser: jest.fn(),
  uploadPreset: "",
  setLoginState: jest.fn(),
  hostId: "test-host",
  activeInstances: [],
};

// Mock redux hooks
jest.mock("../../../hooks/reduxHooks", () => {
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
        <ControllerInfoContext.Provider value={mockControllerContext}>
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
        <ControllerInfoContext.Provider value={contextWithLoading}>
          <GlobalInfoContext.Provider value={mockGlobalContext}>
            <BrowserRouter>
              <CreditsEditor />
            </BrowserRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    // Check for the loading overlay
    const loadingOverlay = screen.getByTestId("loading-overlay");
    expect(loadingOverlay).toBeInTheDocument();
    expect(loadingOverlay).toHaveTextContent(/Setting up/);
    expect(loadingOverlay).toHaveTextContent(/Progress: 50%/);
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

    // Click preview button and wait for state update
    fireEvent.click(showPreviewButton);
    await waitFor(() => {
      const editorContainer = screen.getByTestId("credits-editor-container");
      expect(editorContainer).toHaveClass("hidden");
    });

    // Click editor button and wait for state update
    fireEvent.click(showEditorButton);
    await waitFor(() => {
      const previewContainer = screen.getByTestId("credits-preview-container");
      expect(previewContainer).toHaveClass("hidden");
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

  // it("generates credits from overlays", async () => {
  //   // Set up the mock PouchDB to return an empty list
  //   (mockPouchDB.get as jest.Mock).mockResolvedValueOnce({
  //     _id: "credits",
  //     list: [],
  //   });

  //   renderWithProviders(<CreditsEditor />);

  //   // Wait for initial state to be set
  //   await waitFor(() => {
  //     expect(mockDispatch).toHaveBeenCalledWith(
  //       expect.objectContaining({
  //         type: expect.stringContaining("credits/initiateCreditsList"),
  //       })
  //     );
  //   });

  //   // Wait for loading state to be set to false
  //   await waitFor(() => {
  //     expect(mockDispatch).toHaveBeenCalledWith(
  //       expect.objectContaining({
  //         type: expect.stringContaining("credits/setIsLoading"),
  //         payload: false,
  //       })
  //     );
  //   });

  //   const generateButton = screen.getByTestId("generate-credits-button");

  //   // Verify button is enabled
  //   expect(generateButton).not.toBeDisabled();

  //   // Click the generate button
  //   fireEvent.click(generateButton);

  //   // Wait for the loading state
  //   await waitFor(() => {
  //     expect(screen.getByText("Generating Credits...")).toBeInTheDocument();
  //   });

  //   // Verify getScheduleFromExcel was called
  //   expect(mockGetScheduleFromExcel).toHaveBeenCalledWith(
  //     "2nd Quarter 2025 - Schedule.xlsx",
  //     "/Media Team Positions.xlsx"
  //   );

  //   // Wait for the updateList action to be dispatched and verify its payload
  //   await waitFor(() => {
  //     const updateListCalls = mockDispatch.mock.calls.filter(
  //       (call) => call[0].type === "credits/updateList"
  //     );
  //     expect(updateListCalls.length).toBeGreaterThan(0);
  //   });

  //   const updateListCall = mockDispatch.mock.calls.find(
  //     (call) => call[0].type === "credits/updateList"
  //   );
  //   expect(updateListCall[0].payload).toEqual(
  //     expect.arrayContaining([
  //       expect.objectContaining({
  //         heading: "Sabbath School",
  //         text: "John Doe\nJane Smith",
  //       }),
  //       expect.objectContaining({
  //         heading: "Welcome",
  //         text: "Jane Smith",
  //       }),
  //       expect.objectContaining({
  //         heading: "Call to Praise",
  //         text: "Elder Praise",
  //       }),
  //       expect.objectContaining({
  //         heading: "Invocation",
  //         text: "Elder Invocation",
  //       }),
  //       expect.objectContaining({
  //         heading: "Reading of the Word",
  //         text: "The Reader",
  //       }),
  //       expect.objectContaining({
  //         heading: "Intercessory Prayer",
  //         text: "Mrs. Prayer Ministry",
  //       }),
  //       expect.objectContaining({
  //         heading: "Offertory",
  //         text: "Treasurer",
  //       }),
  //       expect.objectContaining({
  //         heading: "Special Song",
  //         text: "Special Singer",
  //       }),
  //       expect.objectContaining({
  //         heading: "Sermon",
  //         text: "The Pastor",
  //       }),
  //       expect.objectContaining({
  //         heading: "Technical Director",
  //         text: "Mr. Director",
  //       }),
  //       expect.objectContaining({
  //         heading: "Production Coordinators",
  //         text: "Coordinator 1\nCoordinator 2",
  //       }),
  //       expect.objectContaining({
  //         heading: "Audio Engineers",
  //         text: "Front of House - Mr. Mixer\nOnline - Mrs. Studio",
  //       }),
  //       expect.objectContaining({
  //         heading: "Camera Operators",
  //         text: "Camera 1\nCamera 2\nCamera 3\nCamera 4",
  //       }),
  //       expect.objectContaining({
  //         heading: "Graphics",
  //         text: "Graphics Team",
  //       }),
  //     ])
  //   );

  //   // Wait for the success state
  //   await waitFor(() => {
  //     expect(screen.getByText("Generated Credits!")).toBeInTheDocument();
  //   });

  //   // Wait for the success state to be cleared (after 2 seconds)
  //   await waitFor(
  //     () => {
  //       expect(screen.getByText("Generate Credits")).toBeInTheDocument();
  //     },
  //     { timeout: 3000 }
  //   );
  // });

  it("handles database errors gracefully", async () => {
    const contextWithError = {
      ...mockControllerContext,
      db: {
        ...mockPouchDB,
        get: jest.fn().mockRejectedValue({ name: "not_found" }),
      },
    };

    render(
      <Provider store={mockStore}>
        <ControllerInfoContext.Provider value={contextWithError}>
          <GlobalInfoContext.Provider value={mockGlobalContext}>
            <BrowserRouter>
              <CreditsEditor />
            </BrowserRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.stringContaining("credits/initiateCreditsList"),
          payload: [],
        }),
      );
    });

    expect(mockPouchDB.put).toHaveBeenCalledWith({
      _id: "credits",
      list: [],
    });
  });
});
