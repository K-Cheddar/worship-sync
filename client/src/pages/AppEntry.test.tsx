import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppEntry from "./AppEntry";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";

describe("AppEntry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows an offline server notice while keeping the guest demo available", () => {
    const refreshAuthBootstrap = jest.fn();
    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            loginState: "idle",
            sessionKind: null,
            authServerStatus: "offline",
            refreshAuthBootstrap,
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>
    );

    expect(screen.getByText("Could not reach WorshipSync.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign in/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /Link as workstation/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /Link as display/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getAllByText("Connection required to verify this device.")).toHaveLength(2);

    const guestDemo = screen.getByRole("link", { name: /Test as guest/i });
    expect(guestDemo).toBeInTheDocument();
    expect(guestDemo).not.toHaveAttribute("aria-disabled");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(refreshAuthBootstrap).toHaveBeenCalledTimes(1);
  });

  it("explains that a saved session could not be verified when offline", () => {
    localStorage.setItem("loggedIn", "true");

    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            loginState: "idle",
            sessionKind: null,
            authServerStatus: "offline",
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>
    );

    expect(screen.getByText("Could not verify this device.")).toBeInTheDocument();
    expect(screen.getByText("Reconnect to continue")).toBeInTheDocument();
    expect(
      screen.getByText("This device has a saved sign-in or link."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This device may already be signed in or linked, but WorshipSync needs a connection to confirm it. You can retry or use the offline demo on this device.",
      ),
    ).toBeInTheDocument();
  });

  it("redirects shared workstation from root to /home (matches human Home navigation)", async () => {
    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            sessionKind: "workstation",
            operatorName: "Alex",
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
            <Route path="/home" element={<div data-testid="home-hub">Home hub</div>} />
            <Route path="/controller" element={<div data-testid="controller">Controller</div>} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>
    );

    expect(await screen.findByTestId("home-hub")).toBeInTheDocument();
    expect(screen.queryByTestId("controller")).not.toBeInTheDocument();
  });
});
