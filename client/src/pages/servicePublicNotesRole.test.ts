import {
  readServicePublicNotesRole,
  SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY,
  writeServicePublicNotesRole,
} from "./servicePublicNotesRole";

describe("service public role note preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads and writes selected roles as a JSON list", () => {
    writeServicePublicNotesRole(["camera", "lyrics"]);

    expect(localStorage.getItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY)).toBe(
      JSON.stringify(["camera", "lyrics"]),
    );
    expect(readServicePublicNotesRole()).toEqual(["camera", "lyrics"]);
  });

  it("restores a legacy single-role preference", () => {
    localStorage.setItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY, "camera");

    expect(readServicePublicNotesRole()).toEqual(["camera"]);
  });

  it("removes the preference when the role filter is cleared", () => {
    writeServicePublicNotesRole(["camera"]);

    writeServicePublicNotesRole([]);

    expect(
      localStorage.getItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY),
    ).toBeNull();
    expect(readServicePublicNotesRole()).toEqual([]);
  });
});
