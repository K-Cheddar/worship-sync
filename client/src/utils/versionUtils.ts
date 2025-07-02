// Function to fetch and parse changelog for a specific version
export const getChangelogForVersion = async (
  version: string
): Promise<string | null> => {
  try {
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_PATH}/api/changelog`
    );
    if (!response.ok) {
      throw new Error("Failed to fetch changelog");
    }

    const changelogContent = await response.text();

    // Parse the changelog to find the specific version
    const lines = changelogContent.split("\n");
    let inTargetVersion = false;
    let changelogSection: string[] = [];

    for (const line of lines) {
      // Check if this is the start of our target version
      if (line.startsWith(`## [${version}]`)) {
        inTargetVersion = true;
        changelogSection.push(line);
        continue;
      }

      // If we're in the target version section, collect lines
      if (inTargetVersion) {
        // Stop when we hit another version header
        if (line.startsWith("## [")) {
          break;
        }
        changelogSection.push(line);
      }
    }

    if (changelogSection.length > 0) {
      return changelogSection.join("\n").trim();
    }

    return null;
  } catch (error) {
    console.error("Error fetching changelog:", error);
    return null;
  }
};
