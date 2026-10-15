# Schedules performance browser check

From `client/`, run `node e2e/schedules-performance.mjs` with Playwright and Chromium available. Set `PLAYWRIGHT_MODULE_PATH` to an existing Playwright package when it is not installed in this checkout. The runner uses a deterministic fixture (52 generated occurrences, 260 saved occurrences with 260 assignment rows, 20 members, UTC), blocks remote requests, and profiles the real Teams shell and `ScheduleTab` in Chromium. It reports first and repeat visits, browser long tasks, React Profiler commits, CDP CPU samples, module-resource timings, and a rapid switch away while the real lazy section module is held pending. It starts and stops a local Vite server on port 3113, then builds and previews the same fixture in production mode on port 3114 using an ignored cache directory under `node_modules`.


# Isolated smoke navigation regressions

From `client/`, run `node e2e/responsive-navigation.mjs --smoke`. This uses the real Teams editor, scheduling page, shared smoke assertions, and synthetic church/team/service data on localhost. It checks a view-only first team followed by an editable team, an empty next period, restoration of controls, and rejection of error text as an empty state. API responses are local fixtures; no saved authentication or live church is used. The authenticated suite still requires the disposable-church prerequisites in `docs/testing/smoke-coverage.md`.
