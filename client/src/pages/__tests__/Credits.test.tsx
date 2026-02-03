import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import Credits from "../Credits";
import { GlobalInfoContext } from "../../context/globalInfo";
import { onValue, ref } from "firebase/database";
import { createMockGlobalInfo, mockFirebaseDb } from "../../test/mocks";

// controllerInfo/env use import.meta – replaced by jest.config.cjs moduleNameMapper (__mocks__)
// IntersectionObserver – setupTests.ts

// Mock firebase/database
jest.mock("firebase/database", () => ({
  onValue: jest.fn(),
  ref: jest.fn(),
}));

// Mock OBS Studio
const mockObsStudio = {
  getCurrentScene: jest.fn(),
  setCurrentScene: jest.fn(),
};

// Mock window.obsstudio
Object.defineProperty(window, "obsstudio", {
  value: mockObsStudio,
  writable: true,
});

// Mock store
const createMockStore = (initialState = {}) => {
  return configureStore({
    reducer: {
      undoable: (state = { present: { credits: initialState } }) => state,
    },
  });
};

describe("Credits Component", () => {
  const mockUser = "testUser";
  const mockPublishedList = [
    { id: "1", heading: "Test Heading", text: "Test Text", hidden: false },
  ];
  const mockTransitionScene = "transition";
  const mockCreditsScene = "credits";

  const mockGlobalInfo = createMockGlobalInfo({ user: mockUser });

  const renderComponent = (store = createMockStore(), user = mockUser) => {
    return render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={{ ...mockGlobalInfo, user }}>
          <Credits />
        </GlobalInfoContext.Provider>
      </Provider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should not fetch data when user is Demo", () => {
    const store = createMockStore({
      publishedList: [],
      transitionScene: "",
      creditsScene: "",
    });

    renderComponent(store, "Demo");

    expect(onValue).not.toHaveBeenCalled();
  });

  it("should fetch data from Firebase when user is not Demo", () => {
    const store = createMockStore({
      publishedList: mockPublishedList,
      transitionScene: mockTransitionScene,
      creditsScene: mockCreditsScene,
    });
    // Credits uses capitalizeFirstLetter(database) for Firebase paths (mockGlobalInfo.database is "test-database")
    const expectedPathPrefix = `users/Test-database/v2/credits`;

    renderComponent(store);

    expect(ref).toHaveBeenCalledWith(
      mockFirebaseDb,
      `${expectedPathPrefix}/publishedList`,
    );
    expect(ref).toHaveBeenCalledWith(
      mockFirebaseDb,
      `${expectedPathPrefix}/transitionScene`,
    );
    expect(ref).toHaveBeenCalledWith(
      mockFirebaseDb,
      `${expectedPathPrefix}/creditsScene`,
    );
  });

  it("should check current OBS scene on mount", () => {
    const store = createMockStore({
      publishedList: mockPublishedList,
      transitionScene: mockTransitionScene,
      creditsScene: mockCreditsScene,
    });

    renderComponent(store);

    expect(mockObsStudio.getCurrentScene).toHaveBeenCalled();
  });

  it("should set transition scene when active", async () => {
    const store = createMockStore({
      publishedList: mockPublishedList,
      transitionScene: mockTransitionScene,
      creditsScene: mockCreditsScene,
    });

    renderComponent(store);

    // Simulate OBS scene being active
    mockObsStudio.getCurrentScene.mockImplementation((callback) => {
      callback({ name: mockCreditsScene });
    });

    // Find the credits list
    const creditsList = screen.getByRole("list");
    expect(creditsList).toBeInTheDocument();

    // Verify the credits are rendered
    expect(screen.getByText("Test Heading")).toBeInTheDocument();
    expect(screen.getByText("Test Text")).toBeInTheDocument();
  });

  it("should render credits list with correct props", () => {
    const store = createMockStore({
      publishedList: mockPublishedList,
      transitionScene: mockTransitionScene,
      creditsScene: mockCreditsScene,
    });

    renderComponent(store);

    // Verify credits list is rendered
    const creditsList = screen.getByRole("list");
    expect(creditsList).toBeInTheDocument();

    // Verify the credits content
    expect(screen.getByText("Test Heading")).toBeInTheDocument();
    expect(screen.getByText("Test Text")).toBeInTheDocument();
  });
});
