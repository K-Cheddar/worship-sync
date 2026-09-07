const VERSION_PARTS = /^\d+(?:\.\d+){0,2}$/;

const compareVersions = (left, right) => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }

  return 0;
};

/**
 * Resolves the optional minimum web version used only for critical
 * compatibility or security updates. Invalid values fail open so a deployment
 * typo cannot lock every browser client on an update screen.
 */
export const resolveMinimumSupportedWebVersion = (
  configuredVersion,
  deployedVersion,
) => {
  const minimumVersion = configuredVersion?.trim();
  if (!minimumVersion) return null;

  if (
    !VERSION_PARTS.test(minimumVersion) ||
    !VERSION_PARTS.test(deployedVersion) ||
    compareVersions(minimumVersion, deployedVersion) > 0
  ) {
    return null;
  }

  return minimumVersion;
};
