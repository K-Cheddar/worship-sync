# Responsive navigation browser checks

From `client/`, run `node e2e/responsive-navigation.mjs` with Playwright installed and Chromium available. If using an existing installation elsewhere, set `PLAYWRIGHT_MODULE_PATH` to its `playwright` package directory. No authentication or live backend is used.

The runner starts and stops a local Vite fixture server on port 3107 and headless Chromium. It uses the real TeamsAndServices route layout, navigation guard, menu, controls, and Tailwind styles. Remote-data context, page bodies, account controls, and utility modal callbacks use deterministic fixtures. Production providers and lazy page transitions are separately covered in `TeamsAndServices.test.tsx`.

Checks cover 320×568, 390×844, 844×390, 768×1024, 1024×768, and 1440×900 viewports; desktop destinations; bottom selection; secondary tab visibility; nested scrolling and sticky content; header collapse/reveal and focus protection; final action clearance; menu parity including zoom; the mobile drawer's unsaved-change confirmation; desktop-to-phone resizing; reduced motion; simulated safe-area clearance; Home exit; and restricted-route fallback. Screenshots are saved in ignored `artifacts/`.

This harness verifies navigation layout and interactions, not backend authorization, actual page data, native iOS browser chrome, or Electron window behavior.

## Schedules performance browser check

From `client/`, run `node e2e/schedules-performance.mjs` with Playwright and Chromium available. Set `PLAYWRIGHT_MODULE_PATH` to an existing Playwright package when it is not installed in this checkout. The runner uses a deterministic fixture (52 generated occurrences, 260 saved occurrences with 260 assignment rows, 20 members, UTC), blocks remote requests, and profiles the real Teams shell and `ScheduleTab` in Chromium. It reports first and repeat visits, browser long tasks, React Profiler commits, CDP CPU samples, module-resource timings, and a rapid switch away while the real lazy section module is held pending. It starts and stops a local Vite server on port 3113, then builds and previews the same fixture in production mode on port 3114 using an ignored cache directory under `node_modules`.
