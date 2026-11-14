import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ytDlpPath = resolve(__dirname, "../buildResources/video-tools/win32-x64/yt-dlp.exe");
const canRunPinnedWindowsTool = process.platform === "win32" && existsSync(ytDlpPath);

(canRunPinnedWindowsTool ? it : it.skip)(
  "projects metadata larger than 8 MiB into compact title and format JSON using the pinned yt-dlp",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "worshipsync-yt-dlp-projection-"));
    const infoPath = join(directory, "synthetic.info.json");
    const formats = Array.from({ length: 1200 }, (_, index) => ({
      format_id: String(index),
      ext: index % 2 ? "mp4" : "webm",
      vcodec: index % 3 ? "avc1.640028" : "vp9",
      acodec: index % 4 ? "mp4a.40.2" : "opus",
      height: 144 + (index % 20) * 36,
      url: `https://example.invalid/video/${index}?token=${"x".repeat(100)}`,
      format_note: "ignored metadata ".repeat(24),
    }));
    const info = {
      id: "S9EUEdnJQDA",
      extractor: "youtube",
      extractor_key: "Youtube",
      webpage_url: "https://www.youtube.com/watch?v=S9EUEdnJQDA",
      original_url: "https://www.youtube.com/watch?v=S9EUEdnJQDA",
      title: "Synthetic projection test",
      duration: 123,
      description: "x".repeat(9 * 1024 * 1024),
      comments: Array.from({ length: 1500 }, (_, index) => ({
        text: `ignored comment ${index} ${"z".repeat(250)}`,
      })),
      formats,
    };

    try {
      writeFileSync(infoPath, JSON.stringify(info));
      const inputBytes = statSync(infoPath).size;
      const result = spawnSync(ytDlpPath, [
        "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--ies", "youtube",
        "--js-runtimes", `deno:${resolve(__dirname, "../buildResources/video-tools/win32-x64/deno.exe")}`,
        "--no-warnings", "--no-cache-dir", "--no-progress",
        "--print", "%(.{title,duration})j",
        "--print", "%(formats.:.{ext,vcodec,acodec,height})j",
        "--skip-download", "--no-simulate", "--load-info-json", infoPath,
      ], { windowsHide: true, maxBuffer: 1024 * 1024 });

      expect(inputBytes).toBeGreaterThan(8 * 1024 * 1024);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      const lines = (result.stdout?.toString("utf8") ?? "").trimEnd().split(/\r?\n/);
      expect(lines).toHaveLength(2);
      expect(result.stdout?.length ?? 0).toBeLessThan(1024 * 1024);
      expect(JSON.parse(lines[0])).toEqual({ title: info.title, duration: info.duration });
      const projectedFormats = JSON.parse(lines[1]) as Array<Record<string, unknown>>;
      expect(projectedFormats).toHaveLength(formats.length);
      expect(Object.keys(projectedFormats[0]).sort()).toEqual(["acodec", "ext", "height", "vcodec"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
