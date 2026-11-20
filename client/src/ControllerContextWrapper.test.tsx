import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ControllerContextWrapper from "./ControllerContextWrapper";

jest.mock("./context/controllerInfo", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("./context/transferContext", () => ({
  TransferProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("./components/DesktopVideoDownloadManager/DesktopVideoDownloadManager", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("./components/LocalImageUploadManager/LocalImageUploadManager", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("./components/LocalMediaCloudShareManager/LocalMediaCloudShareManager", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("./components/LocalVideoIssueManager/LocalVideoIssueManager", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("./components/LocalVideoCaptureManager/LocalVideoCaptureManager", () => ({
  __esModule: true,
  default: () => <div data-testid="capture-manager" />,
}));
jest.mock("./components/LocalVideoListWarmPublisher/LocalVideoListWarmPublisher", () => ({
  __esModule: true,
  default: () => <div data-testid="list-warm-publisher" />,
}));

const CurrentRoute = () => {
  const { pathname } = useLocation();
  return <p>{pathname}</p>;
};

describe("ControllerContextWrapper route lifetimes", () => {
  it("keeps speculative warming in controller views and keeps the capture manager across viewer and home routes", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/controller/outline"]}>
        <nav>
          <Link to="/controller/slides">Controller slides</Link>
          <Link to="/aux-controller/lobby/slides">Aux Controller</Link>
          <Link to="/current-service/view">Current Service Viewer</Link>
          <Link to="/home">Home</Link>
        </nav>
        <Routes>
          <Route element={<ControllerContextWrapper />}>
            <Route path="/controller/*" element={<CurrentRoute />} />
            <Route path="/aux-controller/:profileId/*" element={<CurrentRoute />} />
            <Route path="/current-service/view" element={<CurrentRoute />} />
            <Route path="/home" element={<CurrentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("list-warm-publisher")).toBeInTheDocument();
    expect(screen.getByTestId("capture-manager")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Controller slides" }));
    expect(screen.getByTestId("list-warm-publisher")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Aux Controller" }));
    expect(screen.getByTestId("list-warm-publisher")).toBeInTheDocument();
    expect(screen.getByTestId("capture-manager")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Current Service Viewer" }));
    expect(screen.queryByTestId("list-warm-publisher")).not.toBeInTheDocument();
    expect(screen.getByTestId("capture-manager")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.queryByTestId("list-warm-publisher")).not.toBeInTheDocument();
    expect(screen.getByTestId("capture-manager")).toBeInTheDocument();
  });
});
