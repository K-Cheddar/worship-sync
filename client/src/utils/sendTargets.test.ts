import { ShouldSendTo } from "../types";
import { DisplayOutput } from "./displayOutputs";
import {
  getSelectedSendTargetIds,
  getSendTargetIdsForType,
  shouldSendToType,
  toggleSendTarget,
} from "./sendTargets";

const outputs: DisplayOutput[] = [
  { id: "projector", type: "projector", name: "Main", order: 0, enabled: true },
  {
    id: "out_lobby",
    type: "projector",
    name: "Lobby",
    order: 1,
    enabled: true,
  },
  { id: "monitor", type: "monitor", name: "Stage", order: 2, enabled: true },
  { id: "stream", type: "stream", name: "Stream", order: 3, enabled: true },
];

const sendTo = (overrides: Partial<ShouldSendTo> = {}): ShouldSendTo => ({
  projector: true,
  monitor: true,
  stream: true,
  ...overrides,
});

describe("getSendTargetIdsForType", () => {
  it("targets the built-in display when nothing is selected", () => {
    // Displays of the same kind must not mirror, so an unconfigured item does
    // not reach a display the operator never picked.
    expect(getSendTargetIdsForType(sendTo(), outputs, "projector")).toEqual([
      "projector",
    ]);
  });

  it("targets exactly the selected displays of that type", () => {
    expect(
      getSendTargetIdsForType(
        sendTo({ outputIds: ["out_lobby", "monitor"] }),
        outputs,
        "projector",
      ),
    ).toEqual(["out_lobby"]);
  });

  it("returns nothing when the selection has no display of that type", () => {
    expect(
      getSendTargetIdsForType(
        sendTo({ outputIds: ["monitor"] }),
        outputs,
        "projector",
      ),
    ).toEqual([]);
  });
});

describe("shouldSendToType", () => {
  it("respects the surface flag", () => {
    expect(
      shouldSendToType(sendTo({ projector: false }), outputs, "projector"),
    ).toBe(false);
  });

  it("is false when the surface is on but no display of that type is picked", () => {
    expect(
      shouldSendToType(
        sendTo({ outputIds: ["monitor"] }),
        outputs,
        "projector",
      ),
    ).toBe(false);
  });

  it("is true for an unconfigured item, which still reaches the built-in", () => {
    expect(shouldSendToType(sendTo(), outputs, "projector")).toBe(true);
  });
});

describe("toggleSendTarget", () => {
  it("adds a display and turns its surface on", () => {
    const next = toggleSendTarget(
      sendTo({ outputIds: ["monitor"], projector: false }),
      outputs,
      "out_lobby",
    );
    expect(next.outputIds).toEqual(["monitor", "out_lobby"]);
    expect(next.projector).toBe(true);
  });

  it("removes a display and turns its surface off when it was the last one", () => {
    const next = toggleSendTarget(
      sendTo({ outputIds: ["out_lobby", "monitor"] }),
      outputs,
      "out_lobby",
    );
    expect(next.outputIds).toEqual(["monitor"]);
    expect(next.projector).toBe(false);
    expect(next.monitor).toBe(true);
  });

  it("keeps the surface on while a sibling display is still selected", () => {
    const next = toggleSendTarget(
      sendTo({ outputIds: ["projector", "out_lobby"] }),
      outputs,
      "out_lobby",
    );
    expect(next.projector).toBe(true);
  });
});

describe("turning off the last target", () => {
  it("lets the final display be deselected without snapping back", () => {
    // An empty selection means "send nowhere", not "back to defaults".
    const next = toggleSendTarget(
      sendTo({ outputIds: ["projector"], monitor: false, stream: false }),
      outputs,
      "projector",
    );
    expect(next.outputIds).toEqual([]);
    expect(next.projector).toBe(false);
    expect(
      getSelectedSendTargetIds(
        { ...sendTo(), ...next } as ShouldSendTo,
        outputs,
      ),
    ).toEqual([]);
  });
});

describe("getSelectedSendTargetIds", () => {
  it("lists the built-ins for an unconfigured item, matching what receives", () => {
    // The shown selection has to equal the actual targets, or the first toggle
    // would look like deselecting one screen while really dropping the rest.
    expect(getSelectedSendTargetIds(sendTo(), outputs)).toEqual([
      "projector",
      "monitor",
      "stream",
    ]);
    expect(getSelectedSendTargetIds(sendTo(), outputs)).not.toContain(
      "out_lobby",
    );
  });

  it("toggling a display off an unconfigured item keeps the others", () => {
    const next = toggleSendTarget(sendTo(), outputs, "monitor");
    expect(next.outputIds).toEqual(["projector", "stream"]);
    expect(next.projector).toBe(true);
    expect(next.stream).toBe(true);
    expect(next.monitor).toBe(false);
  });

  it("omits a retired display from the selection", () => {
    const retired = outputs.map((output) =>
      output.id === "out_lobby" ? { ...output, enabled: false } : output,
    );
    expect(
      getSelectedSendTargetIds(sendTo({ outputIds: ["out_lobby"] }), retired),
    ).toEqual([]);
  });

  it("omits displays whose surface is off", () => {
    expect(
      getSelectedSendTargetIds(sendTo({ stream: false }), outputs),
    ).not.toContain("stream");
  });

  it("lists the explicit selection once one exists", () => {
    expect(
      getSelectedSendTargetIds(sendTo({ outputIds: ["out_lobby"] }), outputs),
    ).toEqual(["out_lobby"]);
  });
});
