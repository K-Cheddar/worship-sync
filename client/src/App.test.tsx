import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { Provider } from "react-redux";
import store from "./store/store";
import { HashRouter as Router } from "react-router-dom";

// Mock gsap to prevent console errors
jest.mock("gsap", () => ({
  registerPlugin: jest.fn(),
  ticker: {
    lagSmoothing: jest.fn(),
  },
}));

// Mock the pages to prevent actual rendering
jest.mock("./pages/Home", () => () => <div>Home Page</div>);
jest.mock("./pages/Controller/Controller", () => () => (
  <div>Controller Page</div>
));
jest.mock("./pages/Login", () => () => <div>Login Page</div>);

describe("App", () => {
  it("renders app with router and provider", () => {
    render(
      <Provider store={store}>
        <Router>
          <App />
        </Router>
      </Provider>
    );

    // Check for main app container
    expect(screen.getByTestId("app")).toBeInTheDocument();

    // Check for router
    expect(screen.getByTestId("router")).toBeInTheDocument();

    // Check for main routes
    expect(screen.getByText("Home Page")).toBeInTheDocument();
    expect(screen.getByText("Controller Page")).toBeInTheDocument();
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("renders routes correctly", () => {
    render(<App />);

    // Check that main routes are rendered
    expect(screen.getByText("Home Page")).toBeInTheDocument();
  });

  it("includes all required providers", () => {
    const { container } = render(<App />);

    // Check for Redux Provider and Router
    expect(container.innerHTML).toContain("Provider");
    expect(container.innerHTML).toContain("Router");
  });
});
