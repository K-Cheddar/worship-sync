import type { Location } from "react-router-dom";
import {
  clearPublicShellAuthReturnPath,
  getAuthRedirectPathnameFromState,
  getAuthRedirectToFromState,
  getHumanPostAuthPath,
  peekPublicShellAuthReturnPath,
  sanitizeAuthRedirectPathname,
  setPublicShellAuthReturnPath,
} from "./authRedirectPath";

const loc = (state: Location["state"]): Location =>
  ({
    pathname: "/login",
    search: "",
    hash: "",
    state,
    key: "k",
  }) as Location;

describe("authRedirectPath", () => {
  beforeEach(() => {
    clearPublicShellAuthReturnPath();
  });

  it("sanitizeAuthRedirectPathname allows known in-app routes", () => {
    expect(sanitizeAuthRedirectPathname("/account")).toBe("/account");
    expect(sanitizeAuthRedirectPathname("/controller/service")).toBe(
      "/controller/service",
    );
    expect(sanitizeAuthRedirectPathname("/aux-controller/ctrl_lobby")).toBe(
      "/aux-controller/ctrl_lobby",
    );
    expect(
      sanitizeAuthRedirectPathname(
        "/aux-controller/ctrl_lobby/item/abc/list-1",
      ),
    ).toBe("/aux-controller/ctrl_lobby/item/abc/list-1");
    expect(sanitizeAuthRedirectPathname("/boards/present/abc123")).toBe(
      "/boards/present/abc123",
    );
  });

  it("sanitizeAuthRedirectPathname rejects unsafe or unknown paths", () => {
    expect(sanitizeAuthRedirectPathname("https://evil.example")).toBeNull();
    expect(sanitizeAuthRedirectPathname("//evil.example")).toBeNull();
    expect(sanitizeAuthRedirectPathname("/totally-unknown-route")).toBeNull();
  });

  it("getAuthRedirectPathnameFromState reads from.pathname", () => {
    expect(
      getAuthRedirectPathnameFromState({
        from: { pathname: "/account", search: "", hash: "", key: "x" },
      }),
    ).toBe("/account");
  });

  it("getAuthRedirectToFromState preserves search for allowed controller paths", () => {
    expect(
      getAuthRedirectToFromState({
        from: {
          pathname: "/controller/bible",
          search: "?search=John%203%3A16&version=NIV",
          hash: "",
          key: "x",
        },
      }),
    ).toBe("/controller/bible?search=John%203%3A16&version=NIV");
  });

  it("getAuthRedirectToFromState keeps auxiliary controller deep links", () => {
    // Shared workstations clear the operator name on restart, so reopen bounces
    // through operator entry with `state.from` set to the saved aux route.
    expect(
      getAuthRedirectToFromState({
        from: {
          pathname: "/aux-controller/ctrl_lobby/songs",
          search: "",
          hash: "",
          key: "x",
        },
      }),
    ).toBe("/aux-controller/ctrl_lobby/songs");
  });

  it("getAuthRedirectPathnameFromState strips query from full redirect", () => {
    expect(
      getAuthRedirectPathnameFromState({
        from: {
          pathname: "/controller/bible",
          search: "?search=test",
          hash: "",
          key: "x",
        },
      }),
    ).toBe("/controller/bible");
  });

  it("getHumanPostAuthPath uses stored path when not root", () => {
    expect(
      getHumanPostAuthPath(
        loc({ from: { pathname: "/account", search: "", hash: "", key: "x" } }),
      ),
    ).toBe("/account");
  });

  it("getHumanPostAuthPath keeps search for deep links", () => {
    expect(
      getHumanPostAuthPath(
        loc({
          from: {
            pathname: "/controller/bible",
            search: "?search=John%203%3A16&version=NIV",
            hash: "",
            key: "x",
          },
        }),
      ),
    ).toBe("/controller/bible?search=John%203%3A16&version=NIV");
  });

  it("getHumanPostAuthPath falls back to /home when missing or root", () => {
    expect(getHumanPostAuthPath(loc(undefined))).toBe("/home");
    expect(
      getHumanPostAuthPath(
        loc({ from: { pathname: "/", search: "", hash: "", key: "x" } }),
      ),
    ).toBe("/home");
  });

  it("getHumanPostAuthPath recovers and clears a public-shell return path", () => {
    setPublicShellAuthReturnPath("/invite");
    expect(peekPublicShellAuthReturnPath()).toBe("/invite");
    expect(getHumanPostAuthPath(loc(undefined))).toBe("/invite");
    expect(peekPublicShellAuthReturnPath()).toBeNull();
  });

  it("getHumanPostAuthPath prefers location state over the shell return path", () => {
    setPublicShellAuthReturnPath("/invite");
    expect(
      getHumanPostAuthPath(
        loc({ from: { pathname: "/account", search: "", hash: "", key: "x" } }),
      ),
    ).toBe("/account");
    expect(peekPublicShellAuthReturnPath()).toBe("/invite");
    clearPublicShellAuthReturnPath();
  });

  it("rejects unsafe public-shell return paths", () => {
    setPublicShellAuthReturnPath("https://evil.example");
    expect(peekPublicShellAuthReturnPath()).toBeNull();
  });

  it("getAuthRedirectPathnameFromState drops unknown redirect paths", () => {
    expect(
      getAuthRedirectPathnameFromState({
        from: {
          pathname: "/unknown-destination",
          search: "",
          hash: "",
          key: "x",
        },
      }),
    ).toBeNull();
  });
});
