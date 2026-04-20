import type { Location } from "react-router-dom";
import {
  getAuthRedirectPathnameFromState,
  getAuthRedirectToFromState,
  getHumanPostAuthPath,
  sanitizeAuthRedirectPathname,
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
  it("sanitizeAuthRedirectPathname allows known in-app routes", () => {
    expect(sanitizeAuthRedirectPathname("/account")).toBe("/account");
    expect(sanitizeAuthRedirectPathname("/controller/service")).toBe(
      "/controller/service",
    );
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
