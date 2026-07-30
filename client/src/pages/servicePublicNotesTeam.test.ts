import {
  readServicePublicNotesTeam,
  SERVICE_PUBLIC_NOTES_TEAM_STORAGE_KEY,
  writeServicePublicNotesTeam,
} from "./servicePublicNotesTeam";

describe("servicePublicNotesTeam", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads and writes the preferred team notes filter", () => {
    expect(readServicePublicNotesTeam()).toBe("");

    writeServicePublicNotesTeam("Media Team");
    expect(localStorage.getItem(SERVICE_PUBLIC_NOTES_TEAM_STORAGE_KEY)).toBe(
      "Media Team",
    );
    expect(readServicePublicNotesTeam()).toBe("Media Team");

    writeServicePublicNotesTeam("");
    expect(localStorage.getItem(SERVICE_PUBLIC_NOTES_TEAM_STORAGE_KEY)).toBeNull();
    expect(readServicePublicNotesTeam()).toBe("");
  });
});
