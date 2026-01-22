#!/usr/bin/env node
/**
 * Debug script to verify electron-builder icon configuration
 * Run with: node scripts/verify-icon-config.js
 */

import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { statSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const buildResourcesDir = resolve(projectRoot, "buildResources");
const iconPath = resolve(buildResourcesDir, "icon.ico");
const configPath = resolve(projectRoot, "electron-builder.config.js");

console.log("=== Electron Builder Icon Configuration Verification ===\n");

console.log("Project root:", projectRoot);
console.log("Build resources directory:", buildResourcesDir);
console.log("Icon file path:", iconPath);
console.log("Config file path:", configPath);

console.log("\n=== File Existence Checks ===");
console.log("buildResources directory exists:", existsSync(buildResourcesDir));
console.log("icon.ico exists:", existsSync(iconPath));
console.log("config file exists:", existsSync(configPath));

if (existsSync(iconPath)) {
  const stats = statSync(iconPath);
  console.log("\n=== Icon File Details ===");
  console.log("Size:", stats.size, "bytes");
  console.log("Modified:", stats.mtime);
}

if (existsSync(configPath)) {
  console.log("\n=== Config File Contents (win section) ===");
  const configContent = readFileSync(configPath, "utf-8");
  const winSectionMatch = configContent.match(/win:\s*\{[\s\S]*?\n\s*\}/);
  if (winSectionMatch) {
    console.log(winSectionMatch[0]);
  } else {
    console.log("Could not find win section in config");
  }
}

console.log("\n=== Expected Path Resolution ===");
console.log("When buildResources = 'buildResources':");
console.log("  win.icon should resolve to:", resolve(buildResourcesDir, "icon.ico"));
console.log("  nsis.installerIcon should resolve to:", resolve(buildResourcesDir, "icon.ico"));

console.log("\n=== Verification Result ===");
if (existsSync(buildResourcesDir) && existsSync(iconPath) && existsSync(configPath)) {
  console.log("✅ All required files exist");
  console.log("✅ Configuration should work correctly");
} else {
  console.log("❌ Some files are missing!");
  if (!existsSync(buildResourcesDir)) console.log("  - buildResources directory missing");
  if (!existsSync(iconPath)) console.log("  - icon.ico file missing");
  if (!existsSync(configPath)) console.log("  - electron-builder.config.js missing");
  process.exit(1);
}
