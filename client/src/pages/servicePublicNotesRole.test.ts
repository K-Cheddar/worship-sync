import {
  readServicePublicNotesRole,
  SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY,
  writeServicePublicNotesRole,
} from "./servicePublicNotesRole";

describe("service public role note preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads and writes the selected role", () => {
    writeServicePublicNotesRole("camera");

    expect(localStorage.getItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY)).toBe("camera");
    expect(readServicePublicNotesRole()).toBe("camera");
  });

  it("removes the preference when the role filter is cleared", () => {
    writeServicePublicNotesRole("camera");

    writeServicePublicNotesRole("");

    expect(localStorage.getItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY)).toBeNull();
    expect(readServicePublicNotesRole()).toBe("");
  });
});
