import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);

const getArgValue = (flag) => {
  const entry = args.find((arg) => arg.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1) : "";
};

const inputPathArg = getArgValue("--input");
const outputPathArg = getArgValue("--output");
const reportPathArg = getArgValue("--report");
const manifestPathArg = getArgValue("--manifest");
const dryRun = args.includes("--dry-run");

const defaultInputPath = path.join(
  os.homedir(),
  "Downloads",
  "portable-media-export.json"
);
const outputPath =
  path.resolve(outputPathArg || "firebase-rtdb-import.json");
const reportPath =
  path.resolve(reportPathArg || "firebase-rtdb-migration-report.json");
const manifestOutputPath =
  path.resolve("firebase-church-manifest.json");

const DEFAULT_MANIFEST = {
  churches: [
    {
      churchId: "demo",
      name: "Demo",
      contentDatabaseKey: "Demo",
      sourceTenants: ["Demo", "Demo_Music", "Admin"],
    },
    {
      churchId: "eliathah",
      name: "Eliathah",
      contentDatabaseKey: "Eliathah",
      sourceTenants: ["Eliathah", "Eliathah_Music"],
    },
  ],
};

const createEmptyChurchData = () => ({
  activeInstances: {},
  credits: {},
  monitorSettings: {},
  presentation: {},
  services: [],
  timers: [],
});

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const cloneValue = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const normalizePath = (...segments) => segments.filter(Boolean).join(".");

const getArrayItemKey = (item, index) => {
  if (item && typeof item === "object") {
    if (typeof item.id === "string" && item.id) return `id:${item.id}`;
    if (typeof item.name === "string" && item.name) return `name:${item.name}`;
    if (
      typeof item.heading === "string" &&
      item.heading &&
      typeof item.text === "string"
    ) {
      return `heading:${item.heading}:${item.text}`;
    }
  }
  return `index:${index}:${JSON.stringify(item)}`;
};

const recordCollision = (report, churchId, collision) => {
  report.collisions.push({
    churchId,
    ...collision,
  });
};

const mergeArrays = ({
  target,
  source,
  churchId,
  section,
  report,
}) => {
  if (!Array.isArray(target) || target.length === 0) {
    return cloneValue(source);
  }
  if (!Array.isArray(source) || source.length === 0) {
    return target;
  }

  const merged = [...target];
  const seenKeys = new Map();

  target.forEach((item, index) => {
    seenKeys.set(getArrayItemKey(item, index), item);
  });

  source.forEach((item, index) => {
    const key = getArrayItemKey(item, index);
    const existing = seenKeys.get(key);
    if (!existing) {
      merged.push(cloneValue(item));
      seenKeys.set(key, item);
      return;
    }

    if (JSON.stringify(existing) !== JSON.stringify(item)) {
      recordCollision(report, churchId, {
        section,
        path: normalizePath(section, key),
        type: "array-item-conflict",
        keptSourceTenant: report.currentPrimaryTenant,
        skippedSourceTenant: report.currentSourceTenant,
      });
    }
  });

  return merged;
};

const mergeObjectsPreferExisting = ({
  target,
  source,
  churchId,
  section,
  report,
  currentPath = "",
}) => {
  if (!isPlainObject(target) || Object.keys(target).length === 0) {
    return cloneValue(source);
  }
  if (!isPlainObject(source) || Object.keys(source).length === 0) {
    return target;
  }

  const nextTarget = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    const pathKey = normalizePath(currentPath, key);
    const targetValue = nextTarget[key];

    if (targetValue === undefined) {
      nextTarget[key] = cloneValue(sourceValue);
      continue;
    }

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      nextTarget[key] = mergeArrays({
        target: targetValue,
        source: sourceValue,
        churchId,
        section,
        report,
      });
      continue;
    }

    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      nextTarget[key] = mergeObjectsPreferExisting({
        target: targetValue,
        source: sourceValue,
        churchId,
        section,
        report,
        currentPath: pathKey,
      });
      continue;
    }

    if (JSON.stringify(targetValue) !== JSON.stringify(sourceValue)) {
      recordCollision(report, churchId, {
        section,
        path: normalizePath(section, pathKey),
        type: "value-conflict",
        keptSourceTenant: report.currentPrimaryTenant,
        skippedSourceTenant: report.currentSourceTenant,
      });
    }
  }

  return nextTarget;
};

const mergeSection = ({
  churchId,
  section,
  currentValue,
  sourceValue,
  report,
}) => {
  if (section === "activeInstances") {
    const count = isPlainObject(sourceValue) ? Object.keys(sourceValue).length : 0;
    if (count > 0) {
      report.skippedActiveInstances.push({
        churchId,
        tenant: report.currentSourceTenant,
        count,
      });
    }
    return {};
  }

  if (Array.isArray(currentValue) && Array.isArray(sourceValue)) {
    return mergeArrays({
      target: currentValue,
      source: sourceValue,
      churchId,
      section,
      report,
    });
  }

  if (isPlainObject(currentValue) && isPlainObject(sourceValue)) {
    return mergeObjectsPreferExisting({
      target: currentValue,
      source: sourceValue,
      churchId,
      section,
      report,
    });
  }

  if (
    (currentValue === undefined ||
      (Array.isArray(currentValue) && currentValue.length === 0) ||
      (isPlainObject(currentValue) && Object.keys(currentValue).length === 0)) &&
    sourceValue !== undefined
  ) {
    return cloneValue(sourceValue);
  }

  if (
    sourceValue !== undefined &&
    JSON.stringify(currentValue) !== JSON.stringify(sourceValue)
  ) {
    recordCollision(report, churchId, {
      section,
      path: section,
      type: "section-conflict",
      keptSourceTenant: report.currentPrimaryTenant,
      skippedSourceTenant: report.currentSourceTenant,
    });
  }

  return currentValue;
};

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const resolveManifest = async () => {
  if (!manifestPathArg) {
    return DEFAULT_MANIFEST;
  }
  return readJson(path.resolve(manifestPathArg));
};

const ensureInputPath = async () => {
  const candidate = path.resolve(inputPathArg || defaultInputPath);
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    console.error(
      `Could not find export file at ${candidate}. Provide --input=/path/to/portable-media-export.json`
    );
    process.exit(1);
  }
};

const summarizeChurch = (churchConfig, churchData) => ({
  churchId: churchConfig.churchId,
  name: churchConfig.name,
  contentDatabaseKey: churchConfig.contentDatabaseKey,
  sourceTenants: churchConfig.sourceTenants,
  sections: {
    activeInstances: Object.keys(churchData.activeInstances || {}).length,
    credits: Object.keys(churchData.credits || {}).length,
    monitorSettings: Object.keys(churchData.monitorSettings || {}).length,
    presentation: Object.keys(churchData.presentation || {}).length,
    services: Array.isArray(churchData.services) ? churchData.services.length : 0,
    timers: Array.isArray(churchData.timers) ? churchData.timers.length : 0,
  },
});

const run = async () => {
  const inputPath = await ensureInputPath();
  const manifest = await resolveManifest();
  const exportData = await readJson(inputPath);
  const legacyUsers = exportData?.users || {};

  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    outputPath,
    reportPath,
    manifestOutputPath,
    dryRun,
    migratedChurches: [],
    missingTenants: [],
    skippedTenants: Object.keys(legacyUsers).filter(
      (tenant) =>
        !manifest.churches.some((church) => church.sourceTenants.includes(tenant))
    ),
    skippedActiveInstances: [],
    collisions: [],
  };

  const nextRtdbData = {
    churches: {},
  };

  const manifestOutput = {
    churches: {},
  };

  for (const churchConfig of manifest.churches) {
    const churchData = createEmptyChurchData();
    let primaryTenant = "";

    for (const tenant of churchConfig.sourceTenants) {
      const sourceV2 = legacyUsers?.[tenant]?.v2;
      if (!sourceV2 || !isPlainObject(sourceV2)) {
        report.missingTenants.push({
          churchId: churchConfig.churchId,
          tenant,
        });
        continue;
      }

      if (!primaryTenant) {
        primaryTenant = tenant;
      }

      report.currentPrimaryTenant = primaryTenant;
      report.currentSourceTenant = tenant;

      for (const [section, sourceValue] of Object.entries(sourceV2)) {
        if (!(section in churchData)) {
          recordCollision(report, churchConfig.churchId, {
            section,
            path: section,
            type: "unknown-section",
            keptSourceTenant: primaryTenant,
            skippedSourceTenant: tenant,
          });
          continue;
        }

        churchData[section] = mergeSection({
          churchId: churchConfig.churchId,
          section,
          currentValue: churchData[section],
          sourceValue,
          report,
        });
      }
    }

    nextRtdbData.churches[churchConfig.churchId] = {
      name: churchConfig.name,
      data: churchData,
    };

    manifestOutput.churches[churchConfig.churchId] = {
      churchId: churchConfig.churchId,
      name: churchConfig.name,
      contentDatabaseKey: churchConfig.contentDatabaseKey,
      sourceTenants: churchConfig.sourceTenants,
    };

    report.migratedChurches.push(summarizeChurch(churchConfig, churchData));
  }

  delete report.currentPrimaryTenant;
  delete report.currentSourceTenant;

  if (!dryRun) {
    await fs.writeFile(outputPath, JSON.stringify(nextRtdbData, null, 2));
    await fs.writeFile(
      manifestOutputPath,
      JSON.stringify(manifestOutput, null, 2)
    );
  }

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  if (dryRun) {
    console.log(`Dry run complete. Report written to ${reportPath}`);
    return;
  }

  console.log(`RTDB import written to ${outputPath}`);
  console.log(`Church manifest written to ${manifestOutputPath}`);
  console.log(`Migration report written to ${reportPath}`);
};

run().catch((error) => {
  console.error("RTDB migration failed:", error);
  process.exit(1);
});
