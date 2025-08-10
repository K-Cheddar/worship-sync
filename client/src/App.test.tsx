import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import App from "./App";
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

// Mock react-router-dom
jest.mock("react-router-dom", () => {
  const originalModule = jest.requireActual("react-router-dom");
  return {
    ...originalModule,
    HashRouter: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Routes: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Route: ({
      path,
      element,
      children,
    }: {
      path?: string;
      element?: React.ReactNode;
      children?: React.ReactNode;
    }) => {
      // For routes with element but no path (like ControllerContextWrapper), render the children
      if (element && !path) {
        return <div>{children}</div>;
      }
      // For the default route (path is "/"), render the element
      if (path === "/") {
        return <div>{element}</div>;
      }
      // For other routes, don't render anything in the test
      return null;
    },
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
jest.mock("./pages/Controller/Controller", () => () => (
  <div data-testid="controller-page">Controller Page</div>
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
  <div data-testid="login-page">Login Page</div>
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

// Mock the context providers
jest.mock("./context/globalInfo", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

jest.mock("./ControllerContextWrapper", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("App Component", () => {
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

  test("renders home page by default", () => {
    renderApp();
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
  });
});
