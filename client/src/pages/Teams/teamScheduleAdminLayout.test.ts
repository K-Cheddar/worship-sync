import {
  readTeamScheduleAdminLayout,
  resolveInitialTeamScheduleAdminLayout,
  TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY,
  toScheduleExportLayout,
  writeTeamScheduleAdminLayout,
} from "./teamScheduleAdminLayout";

/** Stub matchMedia so the responsive default can be exercised both ways. */
const setNarrowScreen = (matches: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

describe("teamScheduleAdminLayout", () => {
  beforeEach(() => {
    localStorage.clear();
    setNarrowScreen(false);
  });

  it("returns null when the user has no stored preference", () => {
    expect(readTeamScheduleAdminLayout()).toBeNull();
  });

  it("reads and writes a valid layout preference", () => {
    writeTeamScheduleAdminLayout("grid");
    expect(localStorage.getItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY)).toBe(
      "grid",
    );
    expect(readTeamScheduleAdminLayout()).toBe("grid");
  });

  it("accepts the board layout as a stored preference", () => {
    writeTeamScheduleAdminLayout("board");
    expect(readTeamScheduleAdminLayout()).toBe("board");
  });

  it("ignores stored values the admin no longer offers", () => {
    localStorage.setItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY, "byDate");
    expect(readTeamScheduleAdminLayout()).toBeNull();
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY, "zigzag");
    expect(readTeamScheduleAdminLayout()).toBeNull();
  });

  describe("resolveInitialTeamScheduleAdminLayout", () => {
    it("honours an explicit stored preference over the responsive default", () => {
      writeTeamScheduleAdminLayout("grid");
      setNarrowScreen(true);
      expect(resolveInitialTeamScheduleAdminLayout()).toBe("grid");
    });

    it("defaults to the by-position table on wide screens", () => {
      setNarrowScreen(false);
      expect(resolveInitialTeamScheduleAdminLayout()).toBe("transpose");
    });

    it("defaults to the card view on narrow screens", () => {
      setNarrowScreen(true);
      expect(resolveInitialTeamScheduleAdminLayout()).toBe("board");
    });
  });

  describe("toScheduleExportLayout", () => {
    it("maps the card view onto the by-date export list", () => {
      expect(toScheduleExportLayout("board")).toBe("byDate");
    });

    it("passes the table layouts through unchanged", () => {
      expect(toScheduleExportLayout("grid")).toBe("grid");
      expect(toScheduleExportLayout("transpose")).toBe("transpose");
    });
  });
});
