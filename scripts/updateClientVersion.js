/**
 * Script to update client version.json after semantic-release
 *
 * Run this script after semantic-release to ensure the client/src/version.json
 * file is updated with the latest version from the root package.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  // Read the updated root package.json to get the new version
  const rootPackagePath = path.join(__dirname, "../package.json");
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, "utf8"));

  // Ensure the client/src directory exists
  const clientSrcPath = path.join(__dirname, "../client/src");
  if (!fs.existsSync(clientSrcPath)) {
    fs.mkdirSync(clientSrcPath, { recursive: true });
  }

  // Path to version.json in client src directory
  const versionOutputPath = path.join(__dirname, "../client/src/version.json");
  const versionData = { version: rootPackage.version };

  // Check if version.json exists and if the version matches
  let shouldUpdate = true;
  if (fs.existsSync(versionOutputPath)) {
    try {
      const currentVersionData = JSON.parse(
        fs.readFileSync(versionOutputPath, "utf8")
      );
      if (currentVersionData.version === rootPackage.version) {
        shouldUpdate = false;
        console.log(
          `ℹ️  client/src/version.json is already up to date (version: ${rootPackage.version})`
        );
      }
    } catch (readErr) {
      // If reading/parsing fails, proceed to update
      shouldUpdate = true;
    }
  }

  if (shouldUpdate) {
    fs.writeFileSync(versionOutputPath, JSON.stringify(versionData, null, 2));
    console.log(
      `✅ Updated client version.json with version: ${rootPackage.version}`
    );

    // Commit the changes to version.json
    try {
      execSync("git add client/src/version.json", { stdio: "inherit" });
      execSync(
        `git commit -m "chore: update client version.json to ${rootPackage.version}"`,
        { stdio: "inherit" }
      );
      console.log("✅ Committed version.json changes to git");
      execSync("git push", { stdio: "inherit" });
      console.log("✅ Pushed version.json changes to remote");
    } catch (gitError) {
      console.warn(
        "⚠️  Warning: Could not commit version.json changes:",
        gitError.message
      );
      console.log(
        "   The file was updated but not committed. You may need to commit manually."
      );
    }
  }
} catch (error) {
  console.error("❌ Error updating client version:", error);
  process.exit(1);
}
