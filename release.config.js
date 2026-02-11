import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Writes client/src/version.json so the release commit and web deploy use the new version. */
function prepareVersionJson(pluginConfig, context) {
  const version = context.nextRelease?.version;
  if (!version) return;
  const versionPath = path.join(__dirname, "client", "src", "version.json");
  fs.writeFileSync(
    versionPath,
    JSON.stringify({ version }, null, 2),
    "utf8"
  );
}

export default {
  branches: ["master"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    [
      "@semantic-release/npm",
      {
        npmPublish: false,
        pkgRoot: ".",
      },
    ],
    [
      "@semantic-release/npm",
      {
        npmPublish: false,
        pkgRoot: "client",
      },
    ],
    { prepare: prepareVersionJson },
    [
      "@semantic-release/git",
      {
        assets: [
          "package.json",
          "client/package.json",
          "client/src/version.json",
          "CHANGELOG.md",
        ],
        message: "chore(release): ${nextRelease.version} [skip ci]",
      },
    ],
    "@semantic-release/github",
  ],
};
