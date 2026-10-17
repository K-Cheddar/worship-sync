import { lazy, Suspense, type ComponentType } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  PendingRouteNavigationProvider,
  PendingRouteReady,
  usePendingRouteNavigation,
} from "./usePendingRouteNavigation";

const deferredModules: Record<string, {
  promise: Promise<{ default: ComponentType }>;
  resolve: () => void;
}> = {};

const makeDeferredPage = (key: string, label: string) => {
  let resolveModule: () => void = () => undefined;
  const promise = new Promise<{ default: ComponentType }>((resolve) => {
    resolveModule = () => resolve({
      default: () => <><h1>{label}</h1><PendingRouteReady routePath={`/account/${key}`} /></>,
    });
  });
  deferredModules[key] = { promise, resolve: resolveModule };
  return lazy(() => promise);
};

const DeferredControllers = makeDeferredPage("controllers", "Controllers");
const DeferredBranding = makeDeferredPage("branding", "Branding");

const Navigation = () => {
  const location = useLocation();
  const { pathname, request } = usePendingRouteNavigation();
  const selected = pathname || location.pathname;
  return (
    <>
      <button onClick={() => request("/account/controllers")}>Controllers link</button>
      <button onClick={() => request("/account/branding")}>Branding link</button>
      <output aria-label="Selected route">{selected}</output>
      <output aria-label="Committed route">{location.pathname}</output>
    </>
  );
};

const renderRouter = () => render(
  <MemoryRouter initialEntries={["/account/people"]}>
    <PendingRouteNavigationProvider>
      <Navigation />
      <Routes>
        <Route path="/account/people" element={<><h1>People</h1><PendingRouteReady routePath="/account/people" /></>} />
        <Route path="/account/controllers" element={<Suspense fallback={<div role="status">Loading controllers</div>}><DeferredControllers /></Suspense>} />
        <Route path="/account/branding" element={<Suspense fallback={<div role="status">Loading branding</div>}><DeferredBranding /></Suspense>} />
      </Routes>
    </PendingRouteNavigationProvider>
  </MemoryRouter>,
);

describe("PendingRouteNavigationProvider", () => {
  it("acknowledges the latest destination immediately and ignores stale completion", async () => {
    const user = userEvent.setup();
    renderRouter();

    await user.click(screen.getByRole("button", { name: "Controllers link" }));
    expect(screen.getByLabelText("Selected route")).toHaveTextContent("/account/controllers");
    expect(screen.getByLabelText("Committed route")).toHaveTextContent("/account/controllers");
    expect(screen.getByText("Loading controllers")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Branding link" }));
    expect(screen.getByLabelText("Selected route")).toHaveTextContent("/account/branding");
    expect(screen.getByText("Loading branding")).toBeInTheDocument();

    await act(async () => deferredModules.controllers.resolve());
    expect(screen.getByLabelText("Selected route")).toHaveTextContent("/account/branding");
    expect(screen.getByText("Loading branding")).toBeInTheDocument();

    await act(async () => deferredModules.branding.resolve());
    expect(await screen.findByRole("heading", { name: "Branding" })).toBeInTheDocument();
    expect(screen.getByLabelText("Selected route")).toHaveTextContent("/account/branding");
  });
});
