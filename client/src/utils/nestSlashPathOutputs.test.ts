import { nestSlashPathOutputs } from "./nestSlashPathOutputs";

describe("nestSlashPathOutputs", () => {
  it("nests Firebase slash-path keys into per-output objects", () => {
    const nested = nestSlashPathOutputs({
      "out_lobby/type": "projector",
      "out_lobby/info": { name: "Welcome", time: 12 },
      "out_lobby/followingOutputId": "",
      "out_foyer/type": "monitor",
      "out_foyer/info": { name: "Next", time: 13 },
    });

    expect(nested).toEqual({
      out_lobby: {
        type: "projector",
        info: { name: "Welcome", time: 12 },
        followingOutputId: "",
      },
      out_foyer: {
        type: "monitor",
        info: { name: "Next", time: 13 },
      },
    });
  });

  it("passes already-nested payloads through", () => {
    const nested = nestSlashPathOutputs({
      out_lobby: {
        type: "projector",
        info: { name: "Welcome", time: 12 },
      },
    });

    expect(nested).toEqual({
      out_lobby: {
        type: "projector",
        info: { name: "Welcome", time: 12 },
      },
    });
  });

  it("merges mixed slash and nested entries for the same output", () => {
    const nested = nestSlashPathOutputs({
      out_lobby: { type: "projector" },
      "out_lobby/info": { name: "Welcome", time: 12 },
    });

    expect(nested.out_lobby).toEqual({
      type: "projector",
      info: { name: "Welcome", time: 12 },
    });
  });

  it("returns an empty object for nullish input", () => {
    expect(nestSlashPathOutputs(null)).toEqual({});
    expect(nestSlashPathOutputs(undefined)).toEqual({});
  });
});
