import {
  createDefaultCurrentServiceWorkspace,
  normalizeCurrentServiceWorkspace,
  resolveCurrentServiceWorkspaceSections,
  resolveCurrentServiceWorkspaceTab,
} from "./currentServiceWorkspace";

describe("current service workspace configuration", () => {
  it("defaults missing configuration to all optional sections", () => {
    expect(createDefaultCurrentServiceWorkspace()).toEqual({
      sections: {
        displays: true,
        credits: true,
        team: true,
        chat: true,
      },
    });
    expect(normalizeCurrentServiceWorkspace(undefined)).toEqual(
      createDefaultCurrentServiceWorkspace(),
    );
  });

  it("resolves zero, one, and multiple configured sections in stable order", () => {
    expect(
      resolveCurrentServiceWorkspaceSections({
        sections: { displays: false, credits: false, team: false, chat: false },
      }, { team: true }),
    ).toEqual([]);
    expect(
      resolveCurrentServiceWorkspaceSections({
        sections: { displays: false, credits: true, team: false, chat: false },
      }, { team: true }),
    ).toEqual([{ key: "credits", tab: "credits", label: "Credits" }]);
    expect(
      resolveCurrentServiceWorkspaceSections({
        sections: { displays: true, credits: false, team: true, chat: true },
      }, { team: true }),
    ).toEqual([
      { key: "displays", tab: "displays", label: "Displays" },
      { key: "team", tab: "serving", label: "Team" },
      { key: "chat", tab: "chat", label: "Chat" },
    ]);
  });

  it("combines the Team setting with Team permission", () => {
    const configuration = {
      sections: { displays: true, credits: true, team: true, chat: true },
    };
    expect(
      resolveCurrentServiceWorkspaceSections(configuration, { team: false }).some(
        (section) => section.key === "team",
      ),
    ).toBe(false);
    expect(
      resolveCurrentServiceWorkspaceSections(configuration, { team: true }).some(
        (section) => section.key === "team",
      ),
    ).toBe(true);
  });

  it("falls back when the selected preview tab becomes unavailable", () => {
    const sections = resolveCurrentServiceWorkspaceSections(
      { sections: { displays: false, credits: true, team: false, chat: true } },
      { team: false },
    );
    expect(resolveCurrentServiceWorkspaceTab("serving", sections)).toBe("credits");
    expect(resolveCurrentServiceWorkspaceTab("plan", sections)).toBe("plan");
    expect(
      resolveCurrentServiceWorkspaceTab("chat", resolveCurrentServiceWorkspaceSections(
        { sections: { displays: false, credits: false, team: false, chat: false } },
        { team: false },
      )),
    ).toBe("plan");
  });
});
