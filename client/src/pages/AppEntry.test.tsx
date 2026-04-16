import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: /Link with code/i })).toBeDisabled();
    const guestDemo = screen.getByRole("button", { name: /Test as guest/i });
    expect(guestDemo).toBeInTheDocument();
    expect(guestDemo).not.toBeDisabled();
    expect(screen.getAllByText("Connection required")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(refreshAuthBootstrap).toHaveBeenCalledTimes(1);
  });

  it("shows loading state while retrying offline reconnect", async () => {
    let resolveRefresh: (() => void) | null = null;
    const refreshAuthBootstrap = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

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
      </GlobalInfoContext.Provider>,
    );

    const tryAgainButton = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(tryAgainButton);

    expect(refreshAuthBootstrap).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Trying again..." })).toBeDisabled();

    await act(async () => {
      resolveRefresh?.();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    });
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
        "WorshipSync can't verify this device with your church right now. You can retry or use the offline demo on this device.",
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
