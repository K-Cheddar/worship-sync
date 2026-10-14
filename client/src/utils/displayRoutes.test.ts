import { getInitialRoutePathname, isTransparentDisplayRoute } from "./displayRoutes";

it.each(["/stream", "/stream-info", "/projector", "/projector-full", "/monitor", "/credits", "/boards/display", "/boards/present/alias"]) (
  "classifies %s including queries and router-compatible trailing slashes", (route) => {
    expect(isTransparentDisplayRoute(route)).toBe(true);
    expect(isTransparentDisplayRoute(`${route}/?outputId=main`)).toBe(true);
    expect(isTransparentDisplayRoute(route.toUpperCase())).toBe(true);
  },
);
it.each(["/home", "/controller", "/streaming", "/stream-info-editor", "/credits-editor", "/boards/controller", "/boards/present", "/boards/present/", "/boards/present/alias/edit"]) (
  "does not classify unrelated route %s", (route) => {
    expect(isTransparentDisplayRoute(route)).toBe(false);
  },
);
it("respects BrowserRouter public paths over hashes", () => {
  expect(getInitialRoutePathname({ pathname: "/services/share", hash: "#/stream" })).toBe("/services/share");
});
it("extracts the operator/Electron hash pathname without the query", () => {
  expect(getInitialRoutePathname({ pathname: "/index.html", hash: "#/stream-info?outputId=main" })).toBe("/stream-info");
});
