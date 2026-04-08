import type { Location } from "react-router-dom";
import {
  getAuthRedirectPathnameFromState,
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
      "/controller/service"
    );
    expect(sanitizeAuthRedirectPathname("/boards/present/abc123")).toBe(
      "/boards/present/abc123"
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
      })
    ).toBe("/account");
  });

  it("getHumanPostAuthPath uses stored path when not root", () => {
    expect(
      getHumanPostAuthPath(
        loc({ from: { pathname: "/account", search: "", hash: "", key: "x" } })
      )
    ).toBe("/account");
  });

  it("getHumanPostAuthPath falls back to /home when missing or root", () => {
    expect(getHumanPostAuthPath(loc(undefined))).toBe("/home");
    expect(
      getHumanPostAuthPath(
        loc({ from: { pathname: "/", search: "", hash: "", key: "x" } })
      )
    ).toBe("/home");
  });

  it("getAuthRedirectPathnameFromState drops unknown redirect paths", () => {
    expect(
      getAuthRedirectPathnameFromState({
        from: { pathname: "/unknown-destination", search: "", hash: "", key: "x" },
      })
    ).toBeNull();
  });
});
