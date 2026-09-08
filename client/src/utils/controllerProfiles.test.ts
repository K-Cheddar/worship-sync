import { DisplayOutput } from "./displayOutputs";
import {
  ControllerProfile,
  OVERLAY_CONTROLLER_ID,
  PRESENTATION_CONTROLLER_ID,
  controllerOwnsOutput,
  getAuxControllerProfiles,
  getControllerDefaultSendIds,
  getControllerOutputs,
  getControllersClaimingOutput,
  getDefaultControllerProfiles,
  getDefaultOutputIds,
  getEffectiveOutputIds,
  getOwningControllerProfile,
  getUniqueControllerProfileName,
  isBuiltInControllerId,
  isKnownControllerProfile,
  toggleControllerOutput,
  normalizeControllerProfiles,
  resolveControllerProfile,
  sanitizeControllerProfileName,
  serializeControllerProfiles,
} from "./controllerProfiles";

const profile = (
  overrides: Partial<ControllerProfile> = {},
): ControllerProfile => ({
  id: "ctrl_1",
  type: "aux-presentation",
  name: "Lobby",
  order: 5,
  enabled: true,
  outputIds: ["out_lobby"],
  outputsConfigured: true,
  defaultSendOutputIds: [],
  outlineScope: "ctrl_1",
  ...overrides,
});

const output = (overrides: Partial<DisplayOutput> = {}): DisplayOutput => ({
  id: "projector",
  type: "projector",
  name: "Main",
  order: 0,
  enabled: true,
  ...overrides,
});

const OUTPUTS = [
  output({ id: "projector", name: "Main" }),
  output({ id: "monitor", type: "monitor", name: "Stage" }),
  output({ id: "stream", type: "stream", name: "Stream" }),
  output({ id: "out_lobby", name: "Lobby" }),
  output({ id: "out_old", name: "Retired", enabled: false }),
  output({ id: "credits", type: "credits", name: "Credits" }),
];

describe("defaults", () => {
  it("seeds both built-ins with nothing saved, so their defaults apply", () => {
    const defaults = getDefaultControllerProfiles();
    expect(defaults.map((p) => p.id)).toEqual([
      PRESENTATION_CONTROLLER_ID,
      OVERLAY_CONTROLLER_ID,
    ]);
    for (const p of defaults) {
      expect(p.outputIds).toEqual([]);
      expect(p.outputsConfigured).toBe(false);
      expect(p.defaultSendOutputIds).toEqual([]);
    }
  });

  it("returns fresh arrays so a caller cannot mutate the shared defaults", () => {
    getDefaultControllerProfiles()[0].outputIds.push("projector");
    expect(getDefaultControllerProfiles()[0].outputIds).toEqual([]);
  });

  it("puts the overlay controller in the presentation outline scope", () => {
    const overlay = getDefaultControllerProfiles().find(
      (p) => p.id === OVERLAY_CONTROLLER_ID,
    );
    expect(overlay?.outlineScope).toBe(PRESENTATION_CONTROLLER_ID);
  });

  it("treats only the seeded ids as built-in", () => {
    expect(isBuiltInControllerId(PRESENTATION_CONTROLLER_ID)).toBe(true);
    expect(isBuiltInControllerId(OVERLAY_CONTROLLER_ID)).toBe(true);
    expect(isBuiltInControllerId("ctrl_1")).toBe(false);
  });
});

describe("normalizeControllerProfiles", () => {
  it("restores the built-ins when the payload is null, garbage, or empty", () => {
    for (const raw of [null, undefined, 42, "nope", {}, []]) {
      expect(normalizeControllerProfiles(raw).map((p) => p.id)).toEqual([
        PRESENTATION_CONTROLLER_ID,
        OVERLAY_CONTROLLER_ID,
      ]);
    }
  });

  it("reads the RTDB object-map form", () => {
    const result = normalizeControllerProfiles({
      ctrl_1: {
        id: "ctrl_1",
        type: "aux-presentation",
        name: "Lobby",
        order: 0,
        outputIds: ["out_lobby"],
      },
    });
    expect(result.find((p) => p.id === "ctrl_1")?.outputIds).toEqual([
      "out_lobby",
    ]);
  });

  it("keeps the built-ins even when the payload defines only a custom controller", () => {
    const ids = normalizeControllerProfiles([
      { id: "ctrl_1", type: "aux-presentation", name: "Lobby", order: 0 },
    ]).map((p) => p.id);
    expect(ids).toContain(PRESENTATION_CONTROLLER_ID);
    expect(ids).toContain(OVERLAY_CONTROLLER_ID);
  });

  it("appends a restored built-in after the church's own ordering", () => {
    const result = normalizeControllerProfiles([
      { id: "ctrl_1", type: "aux-presentation", name: "Lobby", order: 0 },
      {
        id: PRESENTATION_CONTROLLER_ID,
        type: "presentation",
        name: "Main",
        order: 1,
      },
    ]);
    expect(result.map((p) => p.id)).toEqual([
      "ctrl_1",
      PRESENTATION_CONTROLLER_ID,
      OVERLAY_CONTROLLER_ID,
    ]);
  });

  it("forces a built-in back to its canonical type", () => {
    const result = normalizeControllerProfiles([
      {
        id: PRESENTATION_CONTROLLER_ID,
        type: "aux-presentation",
        name: "Main",
        order: 0,
        outputIds: ["projector"],
      },
    ]);
    const presentation = result.find(
      (p) => p.id === PRESENTATION_CONTROLLER_ID,
    );
    expect(presentation?.type).toBe("presentation");
    // The church's own configuration survives the type correction.
    expect(presentation?.outputIds).toEqual(["projector"]);
  });

  it("drops entries with no id or an unknown type", () => {
    const ids = normalizeControllerProfiles([
      { type: "aux-presentation", name: "No id", order: 0 },
      { id: "ctrl_bad", type: "teleprompter", name: "Unknown", order: 1 },
      { id: "ctrl_ok", type: "aux-presentation", name: "Fine", order: 2 },
    ]).map((p) => p.id);
    expect(ids).toContain("ctrl_ok");
    expect(ids).not.toContain("ctrl_bad");
  });

  it("ignores a duplicate id rather than letting the later entry win", () => {
    const result = normalizeControllerProfiles([
      { id: "ctrl_1", type: "aux-presentation", name: "First", order: 0 },
      { id: "ctrl_1", type: "aux-presentation", name: "Second", order: 1 },
    ]);
    expect(result.filter((p) => p.id === "ctrl_1")).toHaveLength(1);
    expect(result.find((p) => p.id === "ctrl_1")?.name).toBe("First");
  });

  it("treats a missing enabled flag as enabled", () => {
    const result = normalizeControllerProfiles([
      { id: "ctrl_1", type: "aux-presentation", name: "Lobby", order: 0 },
    ]);
    expect(result.find((p) => p.id === "ctrl_1")?.enabled).toBe(true);
  });

  it("defaults an absent outline scope to the profile id", () => {
    const result = normalizeControllerProfiles([
      { id: "ctrl_1", type: "aux-presentation", name: "Lobby", order: 0 },
    ]);
    expect(result.find((p) => p.id === "ctrl_1")?.outlineScope).toBe("ctrl_1");
  });

  it("de-duplicates and trims id lists, and accepts the object-map form", () => {
    const result = normalizeControllerProfiles([
      {
        id: "ctrl_1",
        type: "aux-presentation",
        name: "Lobby",
        order: 0,
        outputIds: [" out_lobby ", "out_lobby", "", null],
        defaultSendOutputIds: { 0: "out_lobby" },
      },
    ]);
    const found = result.find((p) => p.id === "ctrl_1");
    expect(found?.outputIds).toEqual(["out_lobby"]);
    expect(found?.defaultSendOutputIds).toEqual(["out_lobby"]);
  });

  it("sorts entries with an unparseable order to the end rather than dropping them", () => {
    const result = normalizeControllerProfiles([
      { id: "ctrl_late", type: "aux-presentation", name: "Late", order: "x" },
      {
        id: PRESENTATION_CONTROLLER_ID,
        type: "presentation",
        name: "Main",
        order: 0,
      },
    ]);
    expect(result[result.length - 1].id).toBe("ctrl_late");
  });

  it("reassigns contiguous order values", () => {
    const result = normalizeControllerProfiles([
      { id: "ctrl_a", type: "aux-presentation", name: "A", order: 40 },
      { id: "ctrl_b", type: "aux-presentation", name: "B", order: 90 },
    ]);
    expect(result.map((p) => p.order)).toEqual([0, 1, 2, 3]);
  });
});

describe("serializeControllerProfiles", () => {
  it("round-trips through normalize", () => {
    const profiles = normalizeControllerProfiles([
      {
        id: "ctrl_1",
        type: "aux-presentation",
        name: "Lobby",
        order: 0,
        outputIds: ["out_lobby"],
        defaultSendOutputIds: ["out_lobby"],
      },
    ]);
    expect(
      normalizeControllerProfiles(serializeControllerProfiles(profiles)),
    ).toEqual(profiles);
  });

  it("keys the map by profile id", () => {
    expect(Object.keys(serializeControllerProfiles([profile()]))).toEqual([
      "ctrl_1",
    ]);
  });
});

describe("names", () => {
  it("collapses whitespace and caps length", () => {
    expect(sanitizeControllerProfileName("  Lobby   Screen ")).toBe(
      "Lobby Screen",
    );
    expect(sanitizeControllerProfileName("x".repeat(80))).toHaveLength(40);
  });

  it("falls back rather than allowing an unnamed controller", () => {
    expect(sanitizeControllerProfileName("   ")).toBe("Controller");
    expect(sanitizeControllerProfileName(null)).toBe("Controller");
  });

  it("suffixes case-insensitive collisions", () => {
    expect(getUniqueControllerProfileName("Lobby", ["lobby"])).toBe("Lobby 2");
    expect(getUniqueControllerProfileName("Lobby", ["Lobby", "Lobby 2"])).toBe(
      "Lobby 3",
    );
  });

  it("leaves a name alone when nothing collides", () => {
    expect(getUniqueControllerProfileName("Lobby", ["Main"])).toBe("Lobby");
  });
});

describe("getControllerOutputs", () => {
  it("gives an auxiliary controller nothing until it is assigned displays", () => {
    expect(
      getControllerOutputs(
        profile({ outputIds: [], outputsConfigured: false }),
        OUTPUTS,
      ),
    ).toEqual([]);
  });

  it("narrows a scoped controller to the displays it owns", () => {
    expect(
      getControllerOutputs(profile({ outputIds: ["out_lobby"] }), OUTPUTS).map(
        (o) => o.id,
      ),
    ).toEqual(["out_lobby"]);
  });

  it("skips displays that are retired or no longer in the registry", () => {
    expect(
      getControllerOutputs(
        profile({ outputIds: ["out_old", "out_gone", "out_lobby"] }),
        OUTPUTS,
      ).map((o) => o.id),
    ).toEqual(["out_lobby"]);
  });

  it("never returns a pull display, which has no presentation state to send to", () => {
    expect(
      getControllerOutputs(profile({ outputIds: ["credits"] }), OUTPUTS),
    ).toEqual([]);
  });

  it("follows registry order rather than the order ids were stored in", () => {
    expect(
      getControllerOutputs(
        profile({ outputIds: ["stream", "projector"] }),
        OUTPUTS,
      ).map((o) => o.id),
    ).toEqual(["projector", "stream"]);
  });
});

describe("what each built-in drives by default", () => {
  it("gives the presentation controller projector, monitor and stream", () => {
    const presentation = getDefaultControllerProfiles().find(
      (p) => p.id === PRESENTATION_CONTROLLER_ID,
    )!;
    expect(getEffectiveOutputIds(presentation)).toEqual([
      "projector",
      "monitor",
      "stream",
    ]);
  });

  it("gives the overlay controller the stream", () => {
    const overlay = getDefaultControllerProfiles().find(
      (p) => p.id === OVERLAY_CONTROLLER_ID,
    )!;
    expect(getEffectiveOutputIds(overlay)).toEqual(["stream"]);
    expect(getControllerOutputs(overlay, OUTPUTS).map((o) => o.id)).toEqual([
      "stream",
    ]);
  });

  it("starts a new controller with nothing, so creating one puts no screen on air", () => {
    expect(getDefaultOutputIds("aux-presentation")).toEqual([]);
  });

  it("lets any display be given to any controller, including overlays", () => {
    // No kind restriction: overlays can be pointed at a projector the day that
    // surface renders one.
    const overlayWithProjector = profile({
      id: OVERLAY_CONTROLLER_ID,
      type: "overlay",
      name: "Overlays",
      outputIds: ["out_lobby"],
    });
    expect(
      getControllerOutputs(overlayWithProjector, OUTPUTS).map((o) => o.id),
    ).toEqual(["out_lobby"]);
  });
});

describe("configured vs never configured", () => {
  it("falls back to the defaults until an operator saves a choice", () => {
    const untouched = profile({
      id: PRESENTATION_CONTROLLER_ID,
      type: "presentation",
      name: "Presentation",
      outputIds: [],
      outputsConfigured: false,
    });
    expect(getEffectiveOutputIds(untouched)).toEqual([
      "projector",
      "monitor",
      "stream",
    ]);
  });

  it("treats a deliberately emptied controller as driving nothing", () => {
    // RTDB drops empty arrays, so without the flag this would read as untouched
    // and hand the controller its defaults back.
    const emptied = profile({
      id: PRESENTATION_CONTROLLER_ID,
      type: "presentation",
      name: "Presentation",
      outputIds: [],
      outputsConfigured: true,
    });
    expect(getEffectiveOutputIds(emptied)).toEqual([]);
    expect(getControllerOutputs(emptied, OUTPUTS)).toEqual([]);
  });

  it("honours a stored list written before the flag existed", () => {
    const legacy = profile({
      outputIds: ["out_lobby"],
      outputsConfigured: false,
    });
    expect(getEffectiveOutputIds(legacy)).toEqual(["out_lobby"]);
  });

  it("drives nothing while the controller is disabled", () => {
    const off = profile({ outputIds: ["out_lobby"], enabled: false });
    expect(getControllerOutputs(off, OUTPUTS)).toEqual([]);
  });
});

describe("toggleControllerOutput", () => {
  const presentation = profile({
    id: "presentation",
    type: "presentation",
    name: "Presentation",
    outputIds: [],
    outputsConfigured: false,
  });

  it("starts from what an untouched controller actually drives", () => {
    // Starting from the stored empty list would turn one click into
    // "drive only this one".
    expect(
      toggleControllerOutput(presentation, OUTPUTS, "out_lobby", false),
    ).toEqual(["projector", "monitor", "stream"]);
  });

  it("adds a display to a scoped controller", () => {
    const lobby = profile({ outputIds: ["out_lobby"], outputsConfigured: true });
    expect(
      toggleControllerOutput(lobby, OUTPUTS, "projector", true),
    ).toEqual(["out_lobby", "projector"]);
  });

  it("keeps a retired assignment the live view cannot show", () => {
    const withRetired = profile({
      outputIds: ["out_old", "out_lobby"],
      outputsConfigured: true,
    });
    expect(
      toggleControllerOutput(withRetired, OUTPUTS, "out_lobby", false),
    ).toEqual(["out_old"]);
  });
});

describe("getControllerDefaultSendIds", () => {
  it("stamps nothing when the controller has no configured default", () => {
    expect(
      getControllerDefaultSendIds(profile({ defaultSendOutputIds: [] }), OUTPUTS),
    ).toEqual([]);
  });

  it("returns the configured defaults", () => {
    expect(
      getControllerDefaultSendIds(
        profile({ outputIds: ["out_lobby"], defaultSendOutputIds: ["out_lobby"] }),
        OUTPUTS,
      ),
    ).toEqual(["out_lobby"]);
  });

  it("drops a default the controller no longer owns", () => {
    expect(
      getControllerDefaultSendIds(
        profile({ outputIds: ["out_lobby"], defaultSendOutputIds: ["projector"] }),
        OUTPUTS,
      ),
    ).toEqual([]);
  });

  it("drops a default whose display was retired", () => {
    expect(
      getControllerDefaultSendIds(
        profile({ outputIds: ["out_old"], defaultSendOutputIds: ["out_old"] }),
        OUTPUTS,
      ),
    ).toEqual([]);
  });
});

describe("ownership", () => {
  it("reports a controller's defaults as displays it owns", () => {
    const overlay = profile({
      id: OVERLAY_CONTROLLER_ID,
      type: "overlay",
      name: "Overlays",
      outputIds: [],
      outputsConfigured: false,
    });
    expect(controllerOwnsOutput(overlay, "stream")).toBe(true);
    expect(controllerOwnsOutput(overlay, "projector")).toBe(false);
  });

  it("keeps a scoped controller off displays it does not own", () => {
    const lobby = profile({ outputIds: ["out_lobby"] });
    expect(controllerOwnsOutput(lobby, "out_lobby")).toBe(true);
    expect(controllerOwnsOutput(lobby, "projector")).toBe(false);
  });

  it("names the owning controller, counting a controller's defaults", () => {
    const profiles = [
      ...getDefaultControllerProfiles(),
      profile({ id: "ctrl_1", outputIds: ["out_lobby"] }),
    ];
    expect(getOwningControllerProfile(profiles, "out_lobby")?.id).toBe("ctrl_1");
    expect(getOwningControllerProfile(profiles, "projector")?.id).toBe(
      PRESENTATION_CONTROLLER_ID,
    );
  });

  it("skips a retired controller when naming the owner", () => {
    const profiles = [
      profile({ id: "ctrl_off", outputIds: ["out_lobby"], enabled: false }),
      profile({ id: "ctrl_on", outputIds: ["out_lobby"] }),
    ];
    expect(getOwningControllerProfile(profiles, "out_lobby")?.id).toBe("ctrl_on");
  });

  it("lists the other controllers claiming a display, for a share warning", () => {
    const profiles = [
      profile({ id: "ctrl_a", name: "Lobby", outputIds: ["out_lobby"] }),
      profile({ id: "ctrl_b", name: "Cafe", outputIds: ["out_lobby"] }),
    ];
    expect(
      getControllersClaimingOutput(profiles, "out_lobby", "ctrl_a").map(
        (p) => p.name,
      ),
    ).toEqual(["Cafe"]);
  });
});

describe("resolveControllerProfile", () => {
  const profiles = [
    ...getDefaultControllerProfiles(),
    profile({ id: "ctrl_1" }),
  ];

  it("finds the requested profile", () => {
    expect(resolveControllerProfile(profiles, "ctrl_1").id).toBe("ctrl_1");
  });

  it("falls back to presentation for a surface with no controller context", () => {
    expect(resolveControllerProfile(profiles, null).id).toBe(
      PRESENTATION_CONTROLLER_ID,
    );
  });

  it("stands in for an unknown controller with one that drives nothing", () => {
    // Its registry entry may simply not have arrived. Falling through to
    // presentation would let a waiting surface inherit the sanctuary's screens.
    const standIn = resolveControllerProfile(profiles, "ctrl_unsynced");
    expect(standIn.id).toBe("ctrl_unsynced");
    expect(standIn.type).toBe("aux-presentation");
    expect(getControllerOutputs(standIn, OUTPUTS)).toEqual([]);
    // Its own outlines still resolve, so the operator can work.
    expect(standIn.outlineScope).toBe("ctrl_unsynced");
  });

  it("reports whether a profile is real or a stand-in", () => {
    expect(
      isKnownControllerProfile(profiles, resolveControllerProfile(profiles, "ctrl_1")),
    ).toBe(true);
    expect(
      isKnownControllerProfile(
        profiles,
        resolveControllerProfile(profiles, "ctrl_unsynced"),
      ),
    ).toBe(false);
  });

  it("still returns a usable profile when the registry is empty", () => {
    // An unknown auxiliary id stands in for itself; only a built-in or absent
    // id falls back to presentation.
    expect(resolveControllerProfile([], "ctrl_1").id).toBe("ctrl_1");
    expect(resolveControllerProfile([], null).id).toBe(
      PRESENTATION_CONTROLLER_ID,
    );
    expect(resolveControllerProfile([], OVERLAY_CONTROLLER_ID).id).toBe(
      PRESENTATION_CONTROLLER_ID,
    );
  });
});

describe("getAuxControllerProfiles", () => {
  it("returns only enabled auxiliary controllers, which are the ones with pages", () => {
    const profiles = [
      ...getDefaultControllerProfiles(),
      profile({ id: "ctrl_on" }),
      profile({ id: "ctrl_off", enabled: false }),
    ];
    expect(getAuxControllerProfiles(profiles).map((p) => p.id)).toEqual([
      "ctrl_on",
    ]);
  });
});
