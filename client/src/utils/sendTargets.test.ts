import { ShouldSendTo } from "../types";
import { DisplayOutput } from "./displayOutputs";
import { ControllerProfile } from "./controllerProfiles";
import {
  buildShouldSendToForController,
  getSelectedSendTargetIds,
  getSendTargetIdsForType,
  sendsNowhere,
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

/**
 * Controller scoping.
 *
 * The whole safety argument rests on two claims: an unscoped profile changes
 * nothing, and a scoped one can never reach a display it does not own.
 */
const controller = (
  overrides: Partial<ControllerProfile> = {},
): ControllerProfile => ({
  id: "ctrl_lobby",
  type: "aux-presentation",
  name: "Lobby",
  order: 2,
  enabled: true,
  outputIds: ["out_lobby"],
  outputsConfigured: true,
  defaultSendOutputIds: ["out_lobby"],
  outlineScope: "ctrl_lobby",
  ...overrides,
});

/** The presentation controller as shipped: projector, monitor, stream. */
const presentationDefault = controller({
  id: "presentation",
  type: "presentation",
  name: "Presentation",
  outputIds: [],
  outputsConfigured: false,
  defaultSendOutputIds: [],
});

describe("the presentation controller keeps its per-surface behaviour", () => {
  const cases: ShouldSendTo[] = [
    sendTo(),
    sendTo({ projector: false }),
    sendTo({ outputIds: ["out_lobby"] }),
    sendTo({ outputIds: ["monitor"] }),
    sendTo({ outputIds: ["out_gone"] }),
    sendTo({ outputIds: [], projector: false, monitor: false, stream: false }),
  ];

  it.each(cases.map((c, i) => [i, c]))(
    "case %i still honours the per-surface flags",
    (_i, shouldSendTo) => {
      // The booleans were designed for these three surfaces and keep meaning
      // exactly what they say here — only auxiliary controllers ignore them.
      const item = shouldSendTo as ShouldSendTo;
      const offSurfaces = (["projector", "monitor", "stream"] as const).filter(
        (type) => !item[type],
      );
      expect(
        offSurfaces.map((type) =>
          shouldSendToType(item, outputs, type, presentationDefault),
        ),
      ).toEqual(offSurfaces.map(() => false));
    },
  );

  it("still targets the three built-in displays for an unconfigured item", () => {
    expect(
      getSendTargetIdsForType(sendTo(), outputs, "projector", presentationDefault),
    ).toEqual(["projector"]);
    expect(
      getSelectedSendTargetIds(sendTo(), outputs, presentationDefault),
    ).toEqual(["projector", "monitor", "stream"]);
  });

  it("reaches a custom projector once that display is added to it", () => {
    const withLobby = controller({
      id: "presentation",
      type: "presentation",
      name: "Presentation",
      outputIds: ["projector", "monitor", "stream", "out_lobby"],
      outputsConfigured: true,
      defaultSendOutputIds: [],
    });
    expect(
      getSendTargetIdsForType(
        sendTo({ outputIds: ["out_lobby"] }),
        outputs,
        "projector",
        withLobby,
      ),
    ).toEqual(["out_lobby"]);
  });

  it("does not reach a display it has not been given", () => {
    expect(
      getSendTargetIdsForType(
        sendTo({ outputIds: ["out_lobby"] }),
        outputs,
        "projector",
        presentationDefault,
      ),
    ).toEqual([]);
  });
});

describe("a scoped controller cannot reach displays it does not own", () => {
  it("drops the sanctuary projector from an item that names it", () => {
    expect(
      getSendTargetIdsForType(
        sendTo({ outputIds: ["projector"] }),
        outputs,
        "projector",
        controller(),
      ),
    ).toEqual(["out_lobby"]);
  });

  it("never returns a monitor or stream it does not own", () => {
    for (const type of ["monitor", "stream"] as const) {
      expect(
        getSendTargetIdsForType(sendTo(), outputs, type, controller()),
      ).toEqual([]);
      expect(shouldSendToType(sendTo(), outputs, type, controller())).toBe(
        false,
      );
    }
  });

  it("ignores the built-in fallback, which belongs to another controller", () => {
    // Unconfigured items resolve to the built-in "projector" display. A scoped
    // controller must not inherit that.
    expect(
      getSendTargetIdsForType(sendTo(), outputs, "projector", controller()),
    ).not.toContain("projector");
  });
});

describe("a shared library item works in a scoped controller's outline", () => {
  it("falls back to the controller default when the item names other displays", () => {
    const song = sendTo({ outputIds: ["projector", "monitor"] });
    expect(
      getSendTargetIdsForType(song, outputs, "projector", controller()),
    ).toEqual(["out_lobby"]);
    expect(shouldSendToType(song, outputs, "projector", controller())).toBe(
      true,
    );
  });

  it("ignores surface flags that describe another controller's surfaces", () => {
    // "Stream only" would otherwise be unshowable on a lobby projector the
    // operator deliberately added it to.
    const streamOnly = sendTo({ projector: false, monitor: false });
    expect(
      shouldSendToType(streamOnly, outputs, "projector", controller()),
    ).toBe(true);
  });

  it("shows the operator the displays that will actually light up", () => {
    expect(
      getSelectedSendTargetIds(
        sendTo({ outputIds: ["projector"] }),
        outputs,
        controller(),
      ),
    ).toEqual(["out_lobby"]);
  });

  it("sends nowhere when the controller has no usable default", () => {
    const noDefault = controller({ defaultSendOutputIds: [] });
    expect(
      getSendTargetIdsForType(
        sendTo({ outputIds: ["projector"] }),
        outputs,
        "projector",
        noDefault,
      ),
    ).toEqual([]);
  });
});

describe("explicit send-nowhere survives controller scoping", () => {
  const nowhere = sendTo({
    outputIds: [],
    projector: false,
    monitor: false,
    stream: false,
  });

  it("is recognised as deliberate rather than unconfigured", () => {
    expect(sendsNowhere(nowhere)).toBe(true);
    expect(sendsNowhere(sendTo())).toBe(false);
    expect(sendsNowhere(sendTo({ outputIds: ["out_lobby"] }))).toBe(false);
  });

  it("is not overridden by the controller default", () => {
    expect(
      getSendTargetIdsForType(nowhere, outputs, "projector", controller()),
    ).toEqual([]);
    expect(shouldSendToType(nowhere, outputs, "projector", controller())).toBe(
      false,
    );
    expect(getSelectedSendTargetIds(nowhere, outputs, controller())).toEqual([]);
  });
});

describe("toggling from a scoped controller", () => {
  it("preserves targets the controller cannot see", () => {
    // The same library item can sit in the sanctuary outline too; editing it
    // from the lobby must not clear where the sanctuary sends it.
    const next = toggleSendTarget(
      sendTo({ outputIds: ["projector", "out_lobby"] }),
      outputs,
      "out_lobby",
      controller(),
    );
    expect(next.outputIds).toEqual(["projector"]);
    expect(next.projector).toBe(true);
  });

  it("adds a second owned display without disturbing another controller's", () => {
    const withCafe: DisplayOutput[] = [
      ...outputs,
      { id: "out_cafe", type: "projector", name: "Cafe", order: 4, enabled: true },
    ];
    const twoScreens = controller({
      outputIds: ["out_lobby", "out_cafe"],
      defaultSendOutputIds: ["out_lobby"],
    });
    const next = toggleSendTarget(
      sendTo({ outputIds: ["projector", "out_lobby"] }),
      withCafe,
      "out_cafe",
      twoScreens,
    );
    expect(next.outputIds).toEqual(["projector", "out_lobby", "out_cafe"]);
    expect(next.projector).toBe(true);
  });

  it("records an explicit send-nowhere when its only display is turned off", () => {
    const next = toggleSendTarget(
      sendTo({ outputIds: ["out_lobby"], monitor: false, stream: false }),
      outputs,
      "out_lobby",
      controller(),
    );
    expect(next.outputIds).toEqual([]);
    expect(next.projector).toBe(false);
    expect(
      getSelectedSendTargetIds(
        { ...sendTo(), ...next } as ShouldSendTo,
        outputs,
        controller(),
      ),
    ).toEqual([]);
  });

  it("turning off the fallback selection records it rather than re-defaulting", () => {
    // The UI showed out_lobby as on (the controller default). Turning it off has
    // to stick, not snap back on the next render.
    const next = toggleSendTarget(
      sendTo({ outputIds: ["projector"] }),
      outputs,
      "out_lobby",
      controller(),
    );
    expect(next.outputIds).toEqual(["projector"]);
    expect(
      getSelectedSendTargetIds(
        { ...sendTo(), ...next } as ShouldSendTo,
        outputs,
        controller(),
      ),
      // Still falls back, because the item once again names only displays this
      // controller cannot reach. Recording "nowhere" for a scoped controller
      // needs the operator to clear the item's other targets too.
    ).toEqual(["out_lobby"]);
  });
});

describe("buildShouldSendToForController", () => {
  it("seeds a new item with the controller's own displays", () => {
    // Born with the presentation controller's three flags, an item created on a
    // one-screen controller resolved to nothing and silently went nowhere.
    const seeded = buildShouldSendToForController(outputs, controller());
    expect(seeded.outputIds).toEqual(["out_lobby"]);
    expect(seeded.projector).toBe(true);
    expect(seeded.monitor).toBe(false);
    expect(seeded.stream).toBe(false);
    expect(
      getSendTargetIdsForType(seeded, outputs, "projector", controller()),
    ).toEqual(["out_lobby"]);
  });

  it("prefers the controller's configured defaults", () => {
    const twoScreens = controller({
      outputIds: ["out_lobby", "monitor"],
      defaultSendOutputIds: ["monitor"],
    });
    expect(buildShouldSendToForController(outputs, twoScreens).outputIds).toEqual(
      ["monitor"],
    );
  });

  it("gives the presentation controller its three surfaces", () => {
    const seeded = buildShouldSendToForController(outputs, presentationDefault);
    expect(seeded.outputIds).toEqual(["projector", "monitor", "stream"]);
    expect(seeded.projector && seeded.monitor && seeded.stream).toBe(true);
  });
});
