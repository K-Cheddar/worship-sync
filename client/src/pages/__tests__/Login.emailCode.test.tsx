import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useMemo, useState, type ReactNode } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import * as authApi from "../../api/auth";
import Login from "../Login";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import { getHumanPostAuthPath } from "../../utils/authRedirectPath";
import { AUTH_EMAIL_CODE_EXPIRED_MESSAGE } from "../../utils/authUserMessages";

type VerifyEmailCodeArgs = { pendingAuthId: string; code: string };
type TestContext = Record<string, unknown>;
type MemoryEntry =
  | string
  | { pathname: string; search?: string; state?: unknown };

const verifyEmailCodeMock = jest.fn(
  async (_args: VerifyEmailCodeArgs): Promise<boolean> => false,
);
let updateTestContext: (updates: TestContext) => void = () => {};
let navigateTestRouter: NavigateFunction = () => {};

jest.mock("../../utils/devFeatures", () => ({
  isCreateChurchUiEnabled: () => true,
}));

jest.mock("../../utils/environment", () => ({
  ...jest.requireActual<typeof import("../../utils/environment")>(
    "../../utils/environment",
  ),
  isElectron: () => false,
}));

const TestContextProvider = ({
  initialContext,
  children,
}: {
  initialContext: TestContext;
  children: ReactNode;
}) => {
  const [value, setValue] = useState(initialContext);
  const location = useLocation();
  const navigate = useNavigate();

  updateTestContext = (updates) => {
    setValue((current) => ({ ...current, ...updates }));
  };
  navigateTestRouter = navigate;

  const contextValue = useMemo(() => {
    const verifyEmailCode = value.verifyEmailCode as (
      args: VerifyEmailCodeArgs,
    ) => Promise<boolean>;

    return {
      ...value,
      verifyEmailCode: async (args: VerifyEmailCodeArgs) => {
        const success = await verifyEmailCode(args);
        if (success) {
          navigate(getHumanPostAuthPath(location), { replace: true });
        }
        return success;
      },
    };
  }, [location, navigate, value]);

  return (
    <GlobalInfoContext.Provider value={contextValue as never}>
      {children}
    </GlobalInfoContext.Provider>
  );
};

const CurrentRoute = () => {
  const location = useLocation();
  return (
    <div data-testid="current-route">
      {location.pathname}
      {location.search}
      {location.hash}
    </div>
  );
};

const LoginRoutes = () => (
  <>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<h1>Signed-in destination</h1>} />
    </Routes>
    <CurrentRoute />
  </>
);

const renderLogin = (
  overrides: TestContext = {},
  entry: MemoryEntry = "/login",
  strictMode = false,
) => {
  const context = {
    ...createMockGlobalContext({
      loginState: "idle",
      sessionKind: null,
      bootstrapStatus: "ready",
      authServerStatus: "online",
      user: "",
      userId: "",
      verifyEmailCode: verifyEmailCodeMock,
      ...overrides,
    }),
  } as TestContext;

  const app = (
    <MemoryRouter initialEntries={[entry]}>
      <TestContextProvider initialContext={context}>
        <LoginRoutes />
      </TestContextProvider>
    </MemoryRouter>
  );

  return {
    context,
    ...render(strictMode ? <StrictMode>{app}</StrictMode> : app),
  };
};

const emailCodeLink = (pendingAuthId: string, code = "123456") =>
  `/login?code=${code}&pendingAuthId=${pendingAuthId}`;

describe("Login email-code sign-in", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    updateTestContext = () => {};
    navigateTestRouter = () => {};
    verifyEmailCodeMock.mockReset().mockResolvedValue(false);
    jest
      .spyOn(authApi, "getEmailCodeHint")
      .mockResolvedValue({
        success: true,
        verificationEmail: "person@example.com",
      });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("automatically verifies a ready email link and honors its safe return path", async () => {
    verifyEmailCodeMock.mockResolvedValue(true);
    renderLogin(
      {},
      {
        pathname: "/login",
        search: "?code=123456&pendingAuthId=pending-fresh-link",
        state: {
          from: {
            pathname: "/current-service",
            search: "?tab=plan",
            hash: "#item-2",
          },
        },
      },
    );

    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
    expect(verifyEmailCodeMock).toHaveBeenCalledWith({
      pendingAuthId: "pending-fresh-link",
      code: "123456",
    });
    await waitFor(() =>
      expect(screen.getByTestId("current-route")).toHaveTextContent(
        "/current-service?tab=plan#item-2",
      ),
    );
  });

  it("waits for delayed bootstrap before starting a populated link", async () => {
    renderLogin(
      {
        bootstrapStatus: "loading",
        loginState: "loading",
      },
      emailCodeLink("pending-delayed-bootstrap"),
    );

    expect(await screen.findByLabelText("Digit 1 of 6")).toHaveValue("1");
    expect(
      await screen.findByText(/Checking your sign-in session/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("current-route")).not.toHaveTextContent(
        /code=|pendingAuthId=/,
      ),
    );
    expect(verifyEmailCodeMock).not.toHaveBeenCalled();

    await act(async () => {
      updateTestContext({ bootstrapStatus: "ready", loginState: "idle" });
    });
    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["same", "pending-explicit-link"],
    ["different", "pending-restored-different"],
  ])(
    "keeps the explicit email link when restoration returns the %s challenge",
    async (_kind, restoredPendingId) => {
      const clearPendingEmailVerification = jest.fn(() =>
        updateTestContext({
          pendingEmailVerificationId: null,
          pendingEmailVerificationEmail: null,
        }),
      );
      renderLogin(
        {
          bootstrapStatus: "loading",
          loginState: "loading",
          clearPendingEmailVerification,
        },
        emailCodeLink("pending-explicit-link"),
      );

      expect(await screen.findByLabelText("Digit 1 of 6")).toHaveValue("1");
      await act(async () => {
        updateTestContext({
          pendingEmailVerificationId: restoredPendingId,
          pendingEmailVerificationEmail: "restored@example.com",
        });
      });

      expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("1");
      expect(verifyEmailCodeMock).not.toHaveBeenCalled();

      await act(async () => {
        updateTestContext({ bootstrapStatus: "ready", loginState: "idle" });
      });

      await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
      expect(verifyEmailCodeMock).toHaveBeenCalledWith({
        pendingAuthId: "pending-explicit-link",
        code: "123456",
      });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Verify device" })).toBeEnabled(),
      );
      expect(
        screen.getByText(
          _kind === "same"
            ? /restored@example.com/
            : /person@example.com/,
        ),
      ).toBeInTheDocument();
      expect(clearPendingEmailVerification).toHaveBeenCalled();
    },
  );

  it("submits the explicit link while a different restored challenge remains pending", async () => {
    renderLogin(
      {
        pendingEmailVerificationId: "pending-restored-different",
        pendingEmailVerificationEmail: "restored@example.com",
        clearPendingEmailVerification: jest.fn(),
      },
      emailCodeLink("pending-explicit-link"),
    );

    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
    expect(verifyEmailCodeMock).toHaveBeenCalledWith({
      pendingAuthId: "pending-explicit-link",
      code: "123456",
    });
  });

  it("keeps a code eligible after an initially disabled login state becomes ready", async () => {
    renderLogin(
      { loginState: "loading" },
      emailCodeLink("pending-initially-disabled"),
    );

    expect(await screen.findByLabelText("Digit 1 of 6")).toHaveValue("1");
    expect(verifyEmailCodeMock).not.toHaveBeenCalled();

    await act(async () => {
      updateTestContext({ loginState: "idle" });
    });
    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
  });

  it("redirects a restored human session without resubmitting the link code", async () => {
    renderLogin(
      {
        bootstrapStatus: "loading",
        loginState: "loading",
        sessionKind: null,
      },
      {
        pathname: "/login",
        search: "?code=123456&pendingAuthId=pending-already-used",
        state: {
          from: {
            pathname: "/account",
            search: "?tab=security",
          },
        },
      },
    );

    expect(await screen.findByLabelText("Digit 1 of 6")).toHaveValue("1");
    await act(async () => {
      updateTestContext({
        bootstrapStatus: "ready",
        loginState: "success",
        sessionKind: "human",
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("current-route")).toHaveTextContent(
        "/account?tab=security",
      ),
    );
    expect(verifyEmailCodeMock).not.toHaveBeenCalled();
  });

  it.each(["workstation", "display"] as const)(
    "does not treat a %s session as completed human code verification",
    async (sessionKind) => {
      const deferred = createDeferred<boolean>();
      verifyEmailCodeMock.mockReturnValue(deferred.promise);
      renderLogin(
        { loginState: "success", sessionKind },
        emailCodeLink(`pending-${sessionKind}-session`),
      );

      await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
      expect(
        await screen.findByText("Verifying your code…"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "You’re signed in" }),
      ).toBeNull();
      expect(screen.getByTestId("current-route")).toHaveTextContent("/login");

      await act(async () => {
        deferred.resolve(false);
        await deferred.promise;
      });
      await waitFor(() =>
        expect(
          screen.queryByText(/Verifying your code/),
        ).not.toBeInTheDocument(),
      );
    },
  );

  it("stops automatic retries after failure and allows a manual retry", async () => {
    const firstAttempt = createDeferred<boolean>();
    verifyEmailCodeMock.mockReturnValue(firstAttempt.promise);
    renderLogin({}, emailCodeLink("pending-failed-retry"));

    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      updateTestContext({ loginState: "loading", authError: "" });
      await Promise.resolve();
    });
    await act(async () => {
      updateTestContext({
        loginState: "error",
        authError: "That code is not valid.",
      });
      firstAttempt.resolve(false);
      await firstAttempt.promise;
    });

    expect(
      await screen.findByText("That code is not valid."),
    ).toBeInTheDocument();
    expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Verify device" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Verify device" }));
    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(2));
    expect(verifyEmailCodeMock).toHaveBeenLastCalledWith({
      pendingAuthId: "pending-failed-retry",
      code: "123456",
    });
  });

  it("switches to a restored challenge when the explicit link has expired", async () => {
    const explicitAttempt = createDeferred<boolean>();
    verifyEmailCodeMock.mockReturnValue(explicitAttempt.promise);
    const clearPendingEmailVerification = jest.fn(() =>
      updateTestContext({
        pendingEmailVerificationId: null,
        pendingEmailVerificationEmail: null,
      }),
    );
    const clearAuthError = jest.fn(() => updateTestContext({ authError: "" }));
    renderLogin(
      { clearPendingEmailVerification, clearAuthError },
      emailCodeLink("pending-expired-link"),
    );

    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      updateTestContext({
        pendingEmailVerificationId: "pending-restored-after-expiration",
        pendingEmailVerificationEmail: "restored@example.com",
      });
    });
    await act(async () => {
      updateTestContext({
        authError: AUTH_EMAIL_CODE_EXPIRED_MESSAGE,
        loginState: "error",
      });
    });
    expect(clearAuthError).toHaveBeenCalled();
    await act(async () => {
      explicitAttempt.resolve(false);
      await explicitAttempt.promise;
    });

    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("");
    expect(screen.getByText(/latest code sent to restored@example.com/)).toBeInTheDocument();
    expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1);

    fireEvent.paste(screen.getByLabelText("Digit 1 of 6"), {
      clipboardData: { getData: () => "654321" },
    });
    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(2));
    expect(verifyEmailCodeMock).toHaveBeenLastCalledWith({
      pendingAuthId: "pending-restored-after-expiration",
      code: "654321",
    });
  });

  it("keeps a newer challenge busy when an older verification finishes", async () => {
    const firstAttempt = createDeferred<boolean>();
    const secondAttempt = createDeferred<boolean>();
    verifyEmailCodeMock.mockImplementation(({ pendingAuthId }) =>
      pendingAuthId === "pending-stale-first"
        ? firstAttempt.promise
        : secondAttempt.promise,
    );
    renderLogin({}, emailCodeLink("pending-stale-first"));

    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      navigateTestRouter(emailCodeLink("pending-stale-second", "654321"));
    });
    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstAttempt.resolve(false);
      await firstAttempt.promise;
    });

    expect(
      await screen.findByText(/Verifying the code you entered/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("current-route")).toHaveTextContent("/login");

    await act(async () => {
      secondAttempt.resolve(false);
      await secondAttempt.promise;
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("6"),
    );
  });

  it("allows reopening a failed link to start a new automatic attempt", async () => {
    const link = emailCodeLink("pending-reopened-link");
    renderLogin({}, link);

    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Verify device" }),
      ).toBeEnabled(),
    );
    expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      navigateTestRouter(link);
    });
    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(2));
    expect(verifyEmailCodeMock).toHaveBeenLastCalledWith({
      pendingAuthId: "pending-reopened-link",
      code: "123456",
    });
  });

  it("clears the old code and accepts a new challenge after an earlier attempt", async () => {
    const clearPendingEmailVerification = jest.fn(() =>
      updateTestContext({
        pendingEmailVerificationId: null,
        pendingEmailVerificationEmail: null,
      }),
    );
    renderLogin(
      { clearPendingEmailVerification },
      "/login?pendingAuthId=pending-change-code",
    );

    expect(await screen.findByLabelText("Digit 1 of 6")).toHaveValue("");
    expect(verifyEmailCodeMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Verify device" }),
      ).toBeEnabled(),
    );
    fireEvent.paste(screen.getByLabelText("Digit 1 of 6"), {
      clipboardData: { getData: () => "654321" },
    });
    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
    expect(verifyEmailCodeMock).toHaveBeenLastCalledWith({
      pendingAuthId: "pending-change-code",
      code: "654321",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Verify device" }),
      ).toBeEnabled(),
    );

    await act(async () => {
      updateTestContext({
        loginState: "idle",
        authError: "",
        pendingEmailVerificationId: "pending-new-challenge",
        pendingEmailVerificationEmail: "new@example.com",
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue(""),
    );
    expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1);

    fireEvent.paste(screen.getByLabelText("Digit 1 of 6"), {
      clipboardData: { getData: () => "987654" },
    });
    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(2));
    expect(verifyEmailCodeMock).toHaveBeenLastCalledWith({
      pendingAuthId: "pending-new-challenge",
      code: "987654",
    });
    expect(clearPendingEmailVerification).toHaveBeenCalled();
  });

  it("does not duplicate a request when Strict Mode replays effects", async () => {
    const deferred = createDeferred<boolean>();
    verifyEmailCodeMock.mockReturnValue(deferred.promise);
    renderLogin({}, emailCodeLink("pending-strict-mode"), true);

    await waitFor(() => expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      deferred.resolve(false);
      await deferred.promise;
    });
    expect(verifyEmailCodeMock).toHaveBeenCalledTimes(1);
  });

  it("submits six digits entered into the code fields", async () => {
    renderLogin({}, "/login?pendingAuthId=pending-manual-entry");
    await screen.findByLabelText("Digit 1 of 6");

    for (const [index, digit] of Array.from("246810").entries()) {
      fireEvent.change(screen.getByLabelText(`Digit ${index + 1} of 6`), {
        target: { value: digit },
      });
    }

    await waitFor(() =>
      expect(verifyEmailCodeMock).toHaveBeenCalledWith({
        pendingAuthId: "pending-manual-entry",
        code: "246810",
      }),
    );
  });

  it("keeps provider sign-in available", async () => {
    const login = jest.fn().mockResolvedValue({
      requiresEmailCode: true,
      pendingAuthId: "pending-provider-flow",
      verificationEmail: "person@example.com",
    });
    const user = userEvent.setup();
    renderLogin({ login });

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({ method: "google" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Digit 1 of 6")).toBeInTheDocument();
  });

  it("resends a code after the cooldown", async () => {
    const resendEmailCode = jest.fn().mockResolvedValue({
      pendingAuthId: "pending-resend-next",
      verificationEmail: "person@example.com",
    });
    jest.useFakeTimers();
    const timedUser = userEvent.setup({
      advanceTimers: (ms) => jest.advanceTimersByTime(ms),
    });
    renderLogin(
      { resendEmailCode },
      "/login?pendingAuthId=pending-resend-start",
    );

    for (let second = 0; second < 60; second += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    await timedUser.click(screen.getByRole("button", { name: "Resend code" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(resendEmailCode).toHaveBeenCalledWith({
      pendingAuthId: "pending-resend-start",
    });
    expect(
      await screen.findByText("We sent a new code to person@example.com."),
    ).toBeInTheDocument();
    expect(verifyEmailCodeMock).not.toHaveBeenCalled();
  });
});

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};
