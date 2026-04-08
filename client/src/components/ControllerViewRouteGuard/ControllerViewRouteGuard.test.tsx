import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import ControllerViewRouteGuard from "./ControllerViewRouteGuard";

jest.mock("../../context/globalInfo", () => {
  const { createContext } = require("react");
  return {
    GlobalInfoContext: createContext(null),
  };
});

const renderGuarded = (
  access: "full" | "view" | "music",
  initialPath: string
) =>
  render(
    <GlobalInfoContext.Provider value={{ access } as never}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ControllerViewRouteGuard>
          <Routes>
            <Route path="/controller" element={<div>Controller home</div>} />
            <Route path="/controller/bible" element={<div>Bible tool</div>} />
            <Route
              path="/controller/preferences"
              element={<div>Preferences page</div>}
            />
            <Route
              path="/controller/item/:a/:b"
              element={<div>Item view</div>}
            />
            <Route path="/controller/create" element={<div>Create item</div>} />
          </Routes>
        </ControllerViewRouteGuard>
      </MemoryRouter>
    </GlobalInfoContext.Provider>
  );

describe("ControllerViewRouteGuard", () => {
  it("allows view access on bible and other content tool routes", () => {
    renderGuarded("view", "/controller/bible");
    expect(screen.getByText("Bible tool")).toBeInTheDocument();
  });

  it("redirects view access away from create route", () => {
    renderGuarded("view", "/controller/create");
    expect(screen.queryByText("Create item")).not.toBeInTheDocument();
    expect(screen.getByText("Controller home")).toBeInTheDocument();
  });

  it("allows view access on controller item routes", () => {
    renderGuarded("view", "/controller/item/x/y");
    expect(screen.getByText("Item view")).toBeInTheDocument();
  });

  it("does not redirect full access from bible route", () => {
    renderGuarded("full", "/controller/bible");
    expect(screen.getByText("Bible tool")).toBeInTheDocument();
  });

  it("redirects view access away from preferences", () => {
    renderGuarded("view", "/controller/preferences");
    expect(screen.queryByText("Preferences page")).not.toBeInTheDocument();
    expect(screen.getByText("Controller home")).toBeInTheDocument();
  });
});
