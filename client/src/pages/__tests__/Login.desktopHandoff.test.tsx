import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  HashRouter, MemoryRouter, Route, Routes, useLocation, useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import * as authApi from "../../api/auth";
import type { DesktopAuthProvider } from "../../api/authTypes";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import {
  isDesktopBrokerAuthCompleted, markDesktopBrokerAuthCompleted,
} from "../../utils/desktopSsoBrowserSession";
import Login from "../Login";
import DesktopSsoComplete from "../DesktopSsoComplete";

const PENDING_KEY = "ws-hosted-desktop-sso";
type AuthResult =
  | { status: "redirect-started" | "requires-existing-method" }
  | { status: "success"; user: { getIdToken: (force: boolean) => Promise<string> } };
const authenticate = jest.fn<Promise<AuthResult>, [unknown]>();
const getIdToken = jest.fn(async () => "firebase-token");
const success: AuthResult = { status: "success", user: { getIdToken } };
let navigate: NavigateFunction;
let updateContext: (updates: Record<string, unknown>) => void;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const handoffUrl = (id: string, provider: DesktopAuthProvider = "google") =>
  `/login?desktopAuthId=${id}&provider=${provider}&keep=yes`;
const storedHandoff = () => JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");

const RouteProbe = () => {
  const location = useLocation();
  navigate = useNavigate();
  return <div data-testid="route">{location.pathname}{location.search}</div>;
};
const ContextProvider = ({ children }: { children: ReactNode }) => {
  const [context, setContext] = useState(() => createMockGlobalContext({
    loginState: "idle", sessionKind: null, user: "", userId: "",
    authenticateHumanWithFirebase: authenticate,
  }));
  updateContext = (updates) => setContext((current) => ({ ...current, ...updates }));
  return (
    <GlobalInfoContext.Provider value={context as never}>
      {children}
    </GlobalInfoContext.Provider>
  );
};
const LoginRoutes = () => (
  <>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/login/desktop-sso-complete" element={<DesktopSsoComplete />} />
      <Route path="*" element={<h1>Browser destination</h1>} />
    </Routes>
    <RouteProbe />
  </>
);
const openLogin = (entry = "/login", strict = true) => {
  window.history.replaceState(null, "", `/#${entry}`);
  const app = <HashRouter><ContextProvider><LoginRoutes /></ContextProvider></HashRouter>;
  return render(strict ? <StrictMode>{app}</StrictMode> : app);
};

describe("hosted desktop browser handoff lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authenticate.mockReset().mockResolvedValue({ status: "redirect-started" });
    getIdToken.mockClear();
    jest.spyOn(authApi, "completeDesktopAuth").mockResolvedValue({
      success: true, status: "awaiting_exchange",
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["google", false], ["microsoft", false], ["google", true], ["microsoft", true],
  ] as const)("retains %s across URL cleanup, rerenders and OAuth return (Strict Mode: %s)", async (provider, strict) => {
    const view = openLogin(handoffUrl("redirect-request", provider), strict);
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    expect(authenticate).toHaveBeenCalledWith({ method: provider, interaction: "redirect" });
    expect(screen.getByTestId("route")).toHaveTextContent("/login?keep=yes");
    expect(storedHandoff()).toEqual({ desktopAuthId: "redirect-request", provider });
    expect(screen.getByRole("button", { name: /Continue with/ })).toBeDisabled();

    await act(async () => {
      updateContext({ authServerRetryCount: 1 });
    });
    await act(async () => {
      updateContext({ loginState: "success", sessionKind: "human" });
    });
    expect(storedHandoff()).toEqual({ desktopAuthId: "redirect-request", provider });
    expect(authenticate).toHaveBeenCalledTimes(1);

    // A full-page Firebase redirect destroys React state; only sessionStorage survives.
    view.unmount();
    authenticate.mockResolvedValue(success);
    openLogin("/login?keep=yes", strict);
    await screen.findByRole("heading", {
      name: `Signed in with ${provider === "google" ? "Google" : "Microsoft"}`,
    });
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(authApi.completeDesktopAuth).toHaveBeenCalledTimes(1);
    expect(authApi.completeDesktopAuth).toHaveBeenCalledWith({
      desktopAuthId: "redirect-request", idToken: "firebase-token",
    });
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(isDesktopBrokerAuthCompleted("redirect-request")).toBe(true);
    expect(screen.getByText(/Return to the WorshipSync desktop app/)).toBeInTheDocument();
  });

  it("does not write or consume storage during render", () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ desktopAuthId: "saved", provider: "google" }));
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const removeItem = jest.spyOn(Storage.prototype, "removeItem");
    renderToString(
      <MemoryRouter initialEntries={[handoffUrl("new", "microsoft")]}>
        <ContextProvider><Login /></ContextProvider>
      </MemoryRouter>,
    );
    renderToString(
      <MemoryRouter><ContextProvider><Login /></ContextProvider></MemoryRouter>,
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(storedHandoff()).toEqual({ desktopAuthId: "saved", provider: "google" });
  });

  it("recovers a saved handoff across Strict Mode reads and repeated mounts without consuming it", async () => {
    const pending = { desktopAuthId: "saved-redirect", provider: "google" };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    const view = openLogin();
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    expect(storedHandoff()).toEqual(pending);
    view.unmount();
    openLogin();
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(2));
    expect(storedHandoff()).toEqual(pending);
    expect(authApi.completeDesktopAuth).not.toHaveBeenCalled();
  });

  it.each(["authentication", "completion"])("retains the handoff after a recoverable %s failure and allows retry", async (stage) => {
    authenticate.mockResolvedValue(success);
    if (stage === "authentication") {
      authenticate.mockRejectedValueOnce(new Error("Provider unavailable"));
    } else {
      jest.mocked(authApi.completeDesktopAuth).mockRejectedValueOnce(
        new authApi.AuthApiError("Could not reach the server.", { isReachabilityError: true }),
      );
    }
    openLogin(handoffUrl("retry-request", "microsoft"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Microsoft" })).toBeEnabled());
    expect(storedHandoff()).toEqual({ desktopAuthId: "retry-request", provider: "microsoft" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Microsoft" }));
    await screen.findByRole("heading", { name: "Signed in with Microsoft" });
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(isDesktopBrokerAuthCompleted("retry-request")).toBe(true);
  });

  it("retains the request when the provider requires an existing sign-in method", async () => {
    authenticate.mockResolvedValue({ status: "requires-existing-method" });
    openLogin(handoffUrl("link-request"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled());
    expect(storedHandoff()).toEqual({ desktopAuthId: "link-request", provider: "google" });
    expect(authApi.completeDesktopAuth).not.toHaveBeenCalled();
  });

  it.each([400, 404, 409, 429, 500])("retains the request for an unconfirmed API failure (%s)", async (status) => {
    authenticate.mockResolvedValue(success);
    jest.mocked(authApi.completeDesktopAuth).mockRejectedValueOnce(
      new authApi.AuthApiError("Request could not be processed.", { status }),
    );
    openLogin(handoffUrl("uncertain-request"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled());
    expect(storedHandoff()).toEqual({ desktopAuthId: "uncertain-request", provider: "google" });
    expect(isDesktopBrokerAuthCompleted("uncertain-request")).toBe(false);
  });

  it("does not restart an already completed request, including after URL cleanup", async () => {
    markDesktopBrokerAuthCompleted("already-done");
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ desktopAuthId: "already-done", provider: "google" }));
    openLogin(handoffUrl("already-done"));
    await act(async () => updateContext({ authServerRetryCount: 2 }));
    expect(screen.getByTestId("route")).toHaveTextContent("/login?keep=yes");
    expect(authenticate).not.toHaveBeenCalled();
    expect(authApi.completeDesktopAuth).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("ignores stale authentication results after a new request replaces the old one", async () => {
    const oldAuth = deferred<AuthResult>();
    authenticate.mockReturnValueOnce(oldAuth.promise);
    openLogin(handoffUrl("old-request"));
    await act(async () => navigate(handoffUrl("new-request", "microsoft")));
    expect(storedHandoff()).toEqual({ desktopAuthId: "new-request", provider: "microsoft" });
    expect(authenticate).toHaveBeenCalledTimes(2);
    await act(async () => oldAuth.resolve(success));
    expect(authApi.completeDesktopAuth).not.toHaveBeenCalled();
    expect(storedHandoff()).toEqual({ desktopAuthId: "new-request", provider: "microsoft" });
    expect(screen.getByRole("button", { name: "Continue with Microsoft" })).toBeDisabled();
  });

  it("does not clear a replacement request or navigate when an older completion succeeds", async () => {
    const completion = deferred<Awaited<ReturnType<typeof authApi.completeDesktopAuth>>>();
    authenticate.mockResolvedValueOnce(success);
    jest.mocked(authApi.completeDesktopAuth).mockReturnValueOnce(completion.promise);
    openLogin(handoffUrl("completing-old"));
    await waitFor(() => expect(authApi.completeDesktopAuth).toHaveBeenCalledTimes(1));
    await act(async () => navigate(handoffUrl("replacement", "microsoft")));
    await act(async () => completion.resolve({ success: true, status: "awaiting_exchange" }));
    expect(isDesktopBrokerAuthCompleted("completing-old")).toBe(true);
    expect(storedHandoff()).toEqual({ desktopAuthId: "replacement", provider: "microsoft" });
    expect(screen.getByTestId("route")).toHaveTextContent("/login?keep=yes");
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(authApi.completeDesktopAuth).toHaveBeenCalledTimes(1);
  });

  it("ignores authentication that returns after unmount", async () => {
    const auth = deferred<AuthResult>();
    authenticate.mockReturnValueOnce(auth.promise);
    const view = openLogin(handoffUrl("unmounted-request"));
    view.unmount();
    await act(async () => auth.resolve(success));
    expect(authApi.completeDesktopAuth).not.toHaveBeenCalled();
    expect(storedHandoff()).toEqual({ desktopAuthId: "unmounted-request", provider: "google" });
  });

  it("adopts an in-flight completion after remount without authenticating or completing twice", async () => {
    const completion = deferred<Awaited<ReturnType<typeof authApi.completeDesktopAuth>>>();
    authenticate.mockResolvedValue(success);
    jest.mocked(authApi.completeDesktopAuth).mockReturnValueOnce(completion.promise);
    const view = openLogin(handoffUrl("remounted-completion"));
    await waitFor(() => expect(authApi.completeDesktopAuth).toHaveBeenCalledTimes(1));
    await act(async () => updateContext({ authServerRetryCount: 3 }));
    expect(authenticate).toHaveBeenCalledTimes(1);
    view.unmount();
    openLogin("/login?keep=yes");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    await act(async () => completion.resolve({ success: true, status: "awaiting_exchange" }));
    await screen.findByRole("heading", { name: "Signed in with Google" });
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authApi.completeDesktopAuth).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("clears a remounted request when the original completion confirms expiration", async () => {
    const completion = deferred<Awaited<ReturnType<typeof authApi.completeDesktopAuth>>>();
    authenticate.mockResolvedValue(success);
    jest.mocked(authApi.completeDesktopAuth).mockReturnValueOnce(completion.promise);
    const view = openLogin(handoffUrl("remounted-expired"));
    await waitFor(() => expect(authApi.completeDesktopAuth).toHaveBeenCalledTimes(1));
    view.unmount();
    openLogin();
    await act(async () => completion.reject(new authApi.AuthApiError(
      "This desktop sign-in request expired. Start again in WorshipSync.", { status: 400 },
    )));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(authApi.completeDesktopAuth).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, "This desktop sign-in request was not found. Start again in WorshipSync."],
    [400, "This desktop sign-in request expired. Start again in WorshipSync."],
    [409, "This desktop sign-in request is already in use. Start again in WorshipSync."],
  ])("clears a confirmed terminal request (%s)", async (status, message) => {
    authenticate.mockResolvedValue(success);
    jest.mocked(authApi.completeDesktopAuth).mockRejectedValueOnce(
      new authApi.AuthApiError(message, { status }),
    );
    openLogin(handoffUrl("terminal-request"));
    await waitFor(() => expect(sessionStorage.getItem(PENDING_KEY)).toBeNull());
    expect(isDesktopBrokerAuthCompleted("terminal-request")).toBe(false);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("keeps ordinary browser sign-in free of desktop authentication", async () => {
    openLogin();
    await act(async () => updateContext({ authServerRetryCount: 1 }));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(authenticate).not.toHaveBeenCalled();
    expect(authApi.completeDesktopAuth).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});
