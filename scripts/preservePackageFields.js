/**
 * Preserve custom fields in package.json after semantic-release updates
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const clientPackagePath = path.join(__dirname, "../client/package.json");
  const clientPackage = JSON.parse(fs.readFileSync(clientPackagePath, "utf8"));

  // Ensure productName is set
  if (!clientPackage.productName) {
    clientPackage.productName = "WorshipSync";
    fs.writeFileSync(
      clientPackagePath,
      JSON.stringify(clientPackage, null, 2) + "\n"
    );
    console.log("✅ Restored productName to client/package.json");
  } else {
    console.log("ℹ️  productName already exists in client/package.json");
  }
} catch (error) {
  console.error("❌ Error preserving package fields:", error);
  process.exit(1);
}
