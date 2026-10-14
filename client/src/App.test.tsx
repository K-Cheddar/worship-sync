import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import App, { AppRoutes } from "./App";
import { GlobalInfoContext } from "./context/globalInfo";
import { createMockGlobalContext } from "./test/mocks";
import { MemoryRouter } from "react-router-dom";
import { presentationSlice } from "./store/presentationSlice";
import { itemSlice } from "./store/itemSlice";
import { overlaysSlice } from "./store/overlaysSlice";
import { bibleSlice } from "./store/bibleSlice";
import { itemListSlice } from "./store/itemListSlice";
import { allItemsSlice } from "./store/allItemsSlice";
import { createItemSlice } from "./store/createItemSlice";
import { preferencesSlice } from "./store/preferencesSlice";
import { itemListsSlice } from "./store/itemListsSlice";
import { mediaItemsSlice } from "./store/mediaSlice";
import { allDocsSlice } from "./store/allDocsSlice";
import { creditsSlice } from "./store/creditsSlice";

let mockBoardPending: Promise<void> | null = null;

// controllerInfo/env use import.meta – replaced by jest.config.cjs moduleNameMapper (__mocks__)

// Mock react-router-dom: use MemoryRouter so useLocation/useNavigate work in tests
jest.mock("react-router-dom", () => {
  const originalModule = jest.requireActual("react-router-dom");
  return {
    ...originalModule,
    HashRouter: originalModule.MemoryRouter,
  };
});

// Create a mock store with initial state
const createMockStore = () => {
  return configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      item: itemSlice.reducer,
      overlays: overlaysSlice.reducer,
      bible: bibleSlice.reducer,
      itemList: itemListSlice.reducer,
      allItems: allItemsSlice.reducer,
      createItem: createItemSlice.reducer,
      preferences: preferencesSlice.reducer,
      itemLists: itemListsSlice.reducer,
      media: mediaItemsSlice.reducer,
      allDocs: allDocsSlice.reducer,
      credits: creditsSlice.reducer,
    },
    preloadedState: {
      presentation: presentationSlice.getInitialState(),
      item: itemSlice.getInitialState(),
      overlays: overlaysSlice.getInitialState(),
      bible: bibleSlice.getInitialState(),
      itemList: itemListSlice.getInitialState(),
      allItems: allItemsSlice.getInitialState(),
      createItem: createItemSlice.getInitialState(),
      preferences: preferencesSlice.getInitialState(),
      itemLists: itemListsSlice.getInitialState(),
      media: mediaItemsSlice.getInitialState(),
      allDocs: allDocsSlice.getInitialState(),
      credits: creditsSlice.getInitialState(),
    },
  });
};

// Mock GSAP and its plugins
jest.mock("gsap", () => ({
  registerPlugin: jest.fn(),
  ticker: {
    lagSmoothing: jest.fn(),
  },
}));

jest.mock("@gsap/react", () => ({
  useGSAP: jest.fn(),
}));

jest.mock("gsap/ScrollToPlugin", () => ({
  ScrollToPlugin: {},
}));

// Mock Cloudinary
jest.mock("@cloudinary/react", () => ({
  CloudinaryContext: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Image: () => <div>Cloudinary Image</div>,
}));

jest.mock("@cloudinary/url-gen", () => ({
  Cloudinary: jest.fn(),
}));

jest.mock("@cloudinary/url-gen/actions/resize", () => ({
  fill: jest.fn(),
}));

// Mock the components to avoid testing their internal logic
jest.mock("./pages/Home", () => () => (
  <div data-testid="home-page">Home Page</div>
));
jest.mock("./pages/AppEntry", () => () => (
  <div data-testid="app-entry-page">App Entry Page</div>
));
jest.mock("./pages/Controller/Controller", () => () => (
  <div data-testid="controller-page">Controller Page</div>
));
jest.mock("./pages/OverlayController/OverlayController", () => () => (
  <div data-testid="overlay-controller-page">Overlay Controller Page</div>
));
jest.mock("./pages/Projector", () => () => (
  <div data-testid="projector-page">Projector Page</div>
));
jest.mock("./pages/Monitor", () => () => (
  <div data-testid="monitor-page">Monitor Page</div>
));
jest.mock("./pages/Stream", () => () => (
  <div data-testid="stream-page">Stream Page</div>
));
jest.mock("./pages/Login", () => () => (
  <div data-testid="login-page">Sign in</div>
));
jest.mock("./pages/Credits", () => () => (
  <div data-testid="credits-page">Credits Page</div>
));
jest.mock("./pages/ProjectorFull", () => () => (
  <div data-testid="projector-full-page">Projector Full Page</div>
));
jest.mock("./pages/CreditsEditor/CreditsEditor", () => () => (
  <div data-testid="credits-editor-page">Credits Editor Page</div>
));
jest.mock("./pages/BoardController", () => () => (
  <div data-testid="board-controller-page">Board Controller Page</div>
));
jest.mock("./pages/BoardDisplay", () => () => (
  <div data-testid="board-display-page">Board Display Page</div>
));
jest.mock("./pages/BoardPage", () => () => (
  <div data-testid="board-page">Board Page</div>
));
jest.mock("./pages/BoardPresent", () => () => {
  if (mockBoardPending) throw mockBoardPending;
  return <div data-testid="board-present-page">Board Present Page</div>;
});
jest.mock("./pages/WorkstationPair", () => () => (
  <div data-testid="workstation-pair-page">Workstation Pair Page</div>
));
jest.mock("./pages/WorkstationOperator", () => () => (
  <div data-testid="workstation-operator-page">Workstation Operator Page</div>
));
jest.mock("./pages/InviteAccept", () => () => (
  <div data-testid="invite-accept-page">Invite Accept Page</div>
));
jest.mock("./pages/PasswordReset", () => () => (
  <div data-testid="password-reset-page">Password Reset Page</div>
));
jest.mock("./pages/RecoveryConfirm", () => () => (
  <div data-testid="recovery-confirm-page">Recovery Confirm Page</div>
));
jest.mock("./pages/Account", () => () => (
  <div data-testid="account-page">Account Page</div>
));
jest.mock("./pages/Teams/TeamsAndServices", () => () => (
  <div data-testid="teams-page">Teams Page</div>
));

// Mock the context providers (value shape from shared mocks)
jest.mock("./context/globalInfo", () => {
  const React = require("react");
  const { createMockGlobalContext } = require("./test/mocks");
  const mockValue = createMockGlobalContext({
    user: "Demo",
    database: "demo",
    firebaseDb: undefined,
  });
  const GlobalInfoContext = React.createContext(mockValue);
  return {
    __esModule: true,
    GlobalInfoContext,
    default: ({ children }: { children: React.ReactNode }) => (
      <GlobalInfoContext.Provider value={mockValue}>
        {children}
      </GlobalInfoContext.Provider>
    ),
  };
});

jest.mock("./ControllerContextWrapper", () => ({
  __esModule: true,
  default: () => {
    const { Outlet } = require("react-router-dom");
    return <Outlet />;
  },
}));

describe("App Component", () => {
  it("keeps the actual route Suspense fallback empty while a display chunk is pending", async () => {
    let finish!: () => void;
    mockBoardPending = new Promise<void>((resolve) => { finish = resolve; });
    const { container } = render(
      <GlobalInfoContext.Provider value={createMockGlobalContext({ bootstrapStatus: "ready" })}>
        <MemoryRouter initialEntries={["/boards/present/alias?outputId=main"]}>
          <AppRoutes />
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );
    // Flush the actual lazy import before checking its suspended fallback.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    await act(async () => { mockBoardPending = null; finish(); });
    expect(screen.getByTestId("board-present-page")).toBeInTheDocument();
  });

  it.each(["/home", "/controller"])("preserves the app auth splash on %s", (path) => {
    render(
      <GlobalInfoContext.Provider value={createMockGlobalContext({ bootstrapStatus: "loading" })}>
        <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
      </GlobalInfoContext.Provider>,
    );
    expect(screen.getByAltText("")).toBeInTheDocument();
    expect(document.body.style.backgroundColor).toBe("rgb(43, 53, 68)");
  });
  it.each(["human", "display", "workstation"].flatMap((sessionKind) =>
    ["/stream", "/stream-info", "/projector", "/projector-full", "/monitor", "/credits", "/boards/display"]
      .map((route) => ({ sessionKind, route })),
  ))(
    "keeps $route authentication transparent for $sessionKind sessions",
    ({ sessionKind, route }) => {
      const { container } = render(
        <GlobalInfoContext.Provider value={createMockGlobalContext({ bootstrapStatus: "loading", sessionKind })}>
          <MemoryRouter initialEntries={[`${route}?outputId=main`]}>
            <AppRoutes />
          </MemoryRouter>
        </GlobalInfoContext.Provider>,
      );
      expect(container.textContent).toBe("");
      expect(screen.queryByAltText("")).toBeNull();
      expect(document.body.style.backgroundColor).toBe("transparent");
    },
  );
  const renderApp = () => {
    const store = createMockStore();
    return render(
      <Provider store={store}>
        <App />
      </Provider>,
    );
  };

  test("renders without crashing", () => {
    renderApp();
  });

  test("renders app entry page by default", () => {
    renderApp();
    expect(screen.getByTestId("app-entry-page")).toBeInTheDocument();
  });
});
