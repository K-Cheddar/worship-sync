import { applyPouchAudit, setAuditSnapshot } from "./pouchAudit";

describe("pouchAudit", () => {
  beforeEach(() => {
    setAuditSnapshot({
      userId: "",
      sessionKind: null,
      operatorName: "",
      deviceLabel: "",
      userEmail: "",
      displayName: "",
    });
  });

  it("applyPouchAudit sets both fields on create using display name when set", () => {
    setAuditSnapshot({
      userId: "uid-1",
      sessionKind: null,
      displayName: "Pat",
    });
    const out = applyPouchAudit(
      null,
      { name: "x" } as { name: string; createdBy?: string; updatedBy?: string },
      { isNew: true },
    );
    expect(out.createdBy).toBe("Pat");
    expect(out.updatedBy).toBe("Pat");
  });

  it("applyPouchAudit falls back to uid when no display name or email", () => {
    setAuditSnapshot({ userId: "uid-only", sessionKind: null });
    const out = applyPouchAudit(
      null,
      { name: "x" } as { name: string; createdBy?: string; updatedBy?: string },
      { isNew: true },
    );
    expect(out.createdBy).toBe("uid-only");
  });

  it("applyPouchAudit preserves createdBy on update", () => {
    setAuditSnapshot({
      userId: "uid-2",
      sessionKind: null,
      displayName: "Editor",
    });
    const existing = {
      createdBy: "orig",
      updatedBy: "old",
      v: 1,
    };
    const out = applyPouchAudit(
      existing,
      { ...existing, v: 2 },
      {
        isNew: false,
      },
    );
    expect(out.createdBy).toBe("orig");
    expect(out.updatedBy).toBe("Editor");
    expect((out as { v: number }).v).toBe(2);
  });
});
