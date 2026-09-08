import {
  buildPersistableRoute,
  getRouteOutputId,
  getRoutePathname,
  withOutputParam,
} from "./displayRoutePersistence";

describe("buildPersistableRoute", () => {
  it("keeps the output so a screen returns to its own display after a restart", () => {
    expect(buildPersistableRoute("/projector-full", "?output=out_lobby")).toBe(
      "/projector-full?output=out_lobby",
    );
  });

  it("drops every other query parameter", () => {
    expect(
      buildPersistableRoute("/monitor", "?output=out_a&token=secret&debug=1"),
    ).toBe("/monitor?output=out_a");
  });

  it("returns the bare pathname when there is no output", () => {
    expect(buildPersistableRoute("/stream", "")).toBe("/stream");
    expect(buildPersistableRoute("/stream", "?debug=1")).toBe("/stream");
  });

  it("refuses an output id that is not one we could have generated", () => {
    expect(buildPersistableRoute("/monitor", "?output=../../etc")).toBe(
      "/monitor",
    );
    expect(buildPersistableRoute("/monitor", "?output=")).toBe("/monitor");
    expect(buildPersistableRoute("/monitor", `?output=${"x".repeat(80)}`)).toBe(
      "/monitor",
    );
  });
});

describe("getRoutePathname", () => {
  it("strips the query so the route still matches the exact allowlist", () => {
    expect(getRoutePathname("/projector-full?output=out_lobby")).toBe(
      "/projector-full",
    );
  });

  it("strips a hash", () => {
    expect(getRoutePathname("/monitor#top")).toBe("/monitor");
  });

  it("leaves a plain path alone", () => {
    expect(getRoutePathname("/stream")).toBe("/stream");
  });
});

describe("getRouteOutputId", () => {
  it("reads the output from a saved route", () => {
    expect(getRouteOutputId("/monitor?output=out_a")).toBe("out_a");
  });

  it("returns null when absent or unsafe", () => {
    expect(getRouteOutputId("/monitor")).toBeNull();
    expect(getRouteOutputId("/monitor?output=%2E%2E%2F")).toBeNull();
  });
});

describe("withOutputParam", () => {
  it("binds a surface route to a display", () => {
    expect(withOutputParam("/projector-full", "out_lobby")).toBe(
      "/projector-full?output=out_lobby",
    );
  });

  it("leaves the route alone without an output", () => {
    expect(withOutputParam("/monitor", null)).toBe("/monitor");
    expect(withOutputParam("/monitor", undefined)).toBe("/monitor");
    expect(withOutputParam("/monitor", "")).toBe("/monitor");
  });

  it("does not override an output the route already names", () => {
    expect(withOutputParam("/monitor?output=out_a", "out_b")).toBe(
      "/monitor?output=out_a",
    );
  });

  it("appends to an existing query string", () => {
    expect(withOutputParam("/monitor?scale=2", "out_a")).toBe(
      "/monitor?scale=2&output=out_a",
    );
  });

  it("ignores an unsafe id rather than building a bad route", () => {
    expect(withOutputParam("/monitor", "../evil")).toBe("/monitor");
  });
});
